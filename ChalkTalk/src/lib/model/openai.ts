import "server-only";
// Any provider that speaks the OpenAI Chat Completions API: OpenAI, Gemini, OpenRouter, Groq, Ollama, or a
// custom LLM_BASE_URL. Plain fetch, no SDK, so one client covers them all.
import { MAX_TOKENS, llmConfig, type ProviderInfo } from "../config";
import { describeBoard, describeLog } from "../board";
import { BOARD_TOOLS } from "../board-tool-defs";
import {
  BOARD_SYSTEM_PROMPT,
  boardMessage,
  SYSTEM_PROMPT,
  editMessage,
  generateMessage,
  homeworkMessage,
  repairMessage,
} from "../prompts";
import type { BoardEvent, BoardTurnInput, Homework, HomeworkInput, SimModel, StreamEvent, Usage } from "../types";

/** Tool-use rounds in one Ask, so a confused turn can't loop forever. */
const MAX_TOOL_ROUNDS = 6;

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Provider data that must go back with the call: Gemini 3 puts its thought signature here. */
  extra_content?: unknown;
}
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChunkDelta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[];
}
interface Chunk {
  choices?: { delta?: ChunkDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

/** An HTTP or network failure, turned into words by friendlyError. */
export class ProviderError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

const OPENAI_TOOLS = BOARD_TOOLS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

/** Pulls the JSON object out of a reply, with or without a ```json fence around it. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model returned no JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export class OpenAICompatibleModel implements SimModel {
  private provider: ProviderInfo;
  private apiKey: string;
  private model: string;
  private url: string;

  constructor() {
    const c = llmConfig();
    this.provider = c.provider;
    this.apiKey = c.apiKey ?? "not-needed";
    this.model = c.model ?? "";
    this.url = `${(c.baseURL ?? "").replace(/\/+$/, "")}/chat/completions`;
  }

  generate(prompt: string): AsyncIterable<StreamEvent> {
    return this.run(generateMessage(prompt));
  }

  repair(code: string, error: string): AsyncIterable<StreamEvent> {
    return this.run(repairMessage(code, error));
  }

  edit(code: string, request: string): AsyncIterable<StreamEvent> {
    return this.run(editMessage(code, request));
  }

  async homework(input: HomeworkInput): Promise<Homework> {
    const ids = input.params.map((p) => p.id);
    const schema = {
      type: "object",
      properties: {
        question: { type: "string" },
        defaults: {
          type: "object",
          properties: Object.fromEntries(ids.map((id) => [id, { type: "number" }])),
          required: ids,
          additionalProperties: false,
        },
      },
      required: ["question", "defaults"],
      additionalProperties: false,
    };
    try {
      const res = await this.post({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: homeworkMessage(input) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "homework", schema, strict: true } },
        ...this.maxTokens(16000),
      });
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      };
      const choice = json.choices?.[0];
      if (choice?.message?.refusal || choice?.finish_reason === "content_filter")
        throw new Error(`${this.provider.assistant} declined to write homework for this sim.`);
      if (choice?.finish_reason === "length") throw new Error("The homework answer was cut off.");
      const text = choice?.message?.content;
      if (!text) throw new Error(`${this.provider.assistant} returned no homework.`);
      const parsed = parseJsonObject(text) as Homework;
      return { question: String(parsed.question), defaults: parsed.defaults ?? {} };
    } catch (err) {
      throw new Error(friendlyError(err, this.provider));
    }
  }

  async *boardTurn(input: BoardTurnInput): AsyncGenerator<BoardEvent> {
    const start = Date.now();
    const first: ContentPart[] = [];
    if (input.image) first.push({ type: "image_url", image_url: { url: `data:image/png;base64,${input.image}` } });
    first.push({
      type: "text",
      text: boardMessage(
        { title: input.board.title, description: describeBoard(input.board.items, input.view), changelog: describeLog(input.board.log) },
        input.message,
      ),
    });
    const messages: ChatMessage[] = [
      { role: "system", content: BOARD_SYSTEM_PROMPT },
      { role: "user", content: first },
    ];
    const usage: Usage = { input_tokens: 0, output_tokens: 0 };
    let acted = false;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        yield { type: "status", stage: "thinking" };
        let text = "";
        const calls: ToolCall[] = [];
        let finish: string | null = null;
        let writing = false;
        for await (const chunk of this.stream({ messages, tools: OPENAI_TOOLS, ...this.maxTokens(16000) })) {
          addUsage(usage, chunk);
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const d = choice?.delta;
          if (!d) continue;
          if (!writing && (d.content || d.tool_calls?.length)) {
            writing = true;
            yield { type: "status", stage: "writing" };
          }
          if (d.content) text += d.content;
          for (const tc of d.tool_calls ?? []) {
            // OpenAI numbers streamed calls with `index`; Gemini sends each call whole, with an id and no index.
            let i = typeof tc.index === "number" ? tc.index : tc.id ? calls.findIndex((c) => c?.id === tc.id) : calls.length - 1;
            if (i < 0) i = calls.length;
            const call = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
            if (tc.id) call.id = tc.id;
            if (tc.extra_content !== undefined) call.extra_content = tc.extra_content;
            if (tc.function?.name) call.function.name += tc.function.name;
            if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
          }
        }
        if (finish === "content_filter") {
          yield { type: "error", message: `${this.provider.assistant} declined this request. Try rewording it.` };
          return;
        }
        const made = calls.filter(Boolean);
        if (!made.length) {
          // Text outside the tools isn't shown on the board; if the model only wrote text, it becomes a note.
          if (!acted && text.trim()) {
            const r = await input.runTool("add_note", { text: text.trim().slice(0, 4000) });
            yield { type: "tool", name: "add_note", ok: !r.isError, text: r.text };
          }
          if (finish === "length")
            yield { type: "tool", name: "", ok: false, text: `${this.provider.assistant}'s answer was cut off.` };
          break;
        }
        made.forEach((c, i) => (c.id ||= `call_${round}_${i}`));
        messages.push({ role: "assistant", content: text || null, tool_calls: made });
        for (const call of made) {
          let args: unknown;
          try {
            args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
          } catch {
            const msg = `The arguments for ${call.function.name} weren't valid JSON.`;
            yield { type: "tool", name: call.function.name, ok: false, text: msg };
            messages.push({ role: "tool", tool_call_id: call.id, content: msg });
            continue;
          }
          const r = await input.runTool(call.function.name, args);
          if (!r.isError && call.function.name !== "get_board" && call.function.name !== "get_changelog") acted = true;
          yield { type: "tool", name: call.function.name, ok: !r.isError, text: r.text };
          messages.push({ role: "tool", tool_call_id: call.id, content: r.isError ? `Error: ${r.text}` : r.text });
        }
      }
      yield { type: "done", usage, ms: Date.now() - start };
    } catch (err) {
      yield { type: "error", message: friendlyError(err, this.provider) };
    }
  }

  private async *run(userText: string): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    const usage: Usage = { input_tokens: 0, output_tokens: 0 };
    try {
      yield { type: "status", stage: "thinking" };
      let writing = false;
      let finish: string | null = null;
      for await (const chunk of this.stream({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
        ...this.maxTokens(MAX_TOKENS),
      })) {
        addUsage(usage, chunk);
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const text = choice?.delta?.content;
        if (text) {
          if (!writing) {
            writing = true;
            yield { type: "status", stage: "writing" };
          }
          yield { type: "delta", text };
        }
      }
      if (finish === "length") {
        yield { type: "error", message: "The simulation was too long and got cut off. Try a simpler request." };
        return;
      }
      if (finish === "content_filter") {
        yield { type: "error", message: `${this.provider.assistant} declined this request. Try rewording it.` };
        return;
      }
      yield { type: "done", stopReason: finish, usage, ms: Date.now() - start };
    } catch (err) {
      yield { type: "error", message: friendlyError(err, this.provider) };
    }
  }

  /** OpenAI's newer models only take max_completion_tokens; most other servers only take max_tokens. */
  private maxTokens(n: number) {
    return this.provider.id === "openai" ? { max_completion_tokens: n } : { max_tokens: n };
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, ...body }),
      });
    } catch (err) {
      throw new ProviderError(null, err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        message = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? message;
      } catch {
        // Not JSON: keep the raw text.
      }
      // The page only gets a friendly line; the provider's own words go to the server log.
      console.warn(`[llm] ${this.provider.label} ${res.status}: ${message}`);
      throw new ProviderError(res.status, message);
    }
    return res;
  }

  /** Streams the server-sent events of one chat completion. */
  private async *stream(body: Record<string, unknown>): AsyncGenerator<Chunk> {
    const usageOption = ["openai", "openrouter", "groq"].includes(this.provider.id)
      ? { stream_options: { include_usage: true } }
      : {};
    const res = await this.post({ ...body, stream: true, ...usageOption });
    if (!res.body) throw new ProviderError(null, "The response had no body.");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(data) as Chunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new ProviderError(null, chunk.error.message ?? "The stream reported an error.");
        yield chunk;
      }
    }
  }
}

function addUsage(usage: Usage, chunk: Chunk) {
  if (!chunk.usage) return;
  usage.input_tokens += chunk.usage.prompt_tokens ?? 0;
  usage.output_tokens += chunk.usage.completion_tokens ?? 0;
}

export function friendlyError(err: unknown, provider: ProviderInfo): string {
  const name = provider.assistant === "AI" ? provider.label : provider.assistant;
  if (err instanceof ProviderError) {
    const s = err.status;
    if (s === null) return `Couldn't reach ${provider.label}: ${err.message}`;
    if (s === 401) return `The ${provider.label} API key was rejected. Check LLM_API_KEY in .env.local.`;
    if (s === 403) return `This ${provider.label} API key can't use that model.`;
    if (s === 404) return `The model wasn't found at ${provider.label}. Check LLM_MODEL (and LLM_BASE_URL) in .env.local.`;
    if (s === 429) return `${name} is busy right now (rate limited). Try again in a moment.`;
    if (s === 400 || s === 422) return `${provider.label} rejected the request: ${err.message}`;
    if (s >= 500) return `${name} is overloaded or having trouble. Try again in a moment.`;
    return `${provider.label} API error (${s}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return `Something went wrong talking to ${name}.`;
}
