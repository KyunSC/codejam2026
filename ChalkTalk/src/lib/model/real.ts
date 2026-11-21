import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, MAX_TOKENS, MODEL } from "../config";
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
import type {
  BoardEvent,
  BoardTurnInput,
  Homework,
  HomeworkInput,
  SimModel,
  StreamEvent,
  Usage,
} from "../types";

/** Tool-use rounds in one Ask Claude, so a confused turn can't loop forever. */
const MAX_TOOL_ROUNDS = 6;

/** Claude-backed model. Only constructed when a key is present (see index.ts). */
export class RealModel implements SimModel {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
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
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: homeworkMessage(input) }],
      });
      if (response.stop_reason === "refusal") throw new Error("Claude declined to write homework for this sim.");
      if (response.stop_reason === "max_tokens") throw new Error("The homework answer was cut off.");
      const text = response.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new Error("Claude returned no homework.");
      const parsed = JSON.parse(text.text) as Homework;
      return { question: String(parsed.question), defaults: parsed.defaults ?? {} };
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  }

  /** One whiteboard turn: Claude reads the board (text + picture) and answers with tool calls, applied by the browser. */
  /**
   * One whiteboard turn: Claude gets the board (items, changelog, picture) and acts through the board tools.
   * Tool results go back to Claude, so it can look again or fix a rejected step, for up to MAX_TOOL_ROUNDS rounds.
   */
  async *boardTurn(input: BoardTurnInput): AsyncGenerator<BoardEvent> {
    const start = Date.now();
    const first: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.image) first.push({ type: "image", source: { type: "base64", media_type: "image/png", data: input.image } });
    first.push({
      type: "text",
      text: boardMessage(
        { title: input.board.title, description: describeBoard(input.board.items, input.view), changelog: describeLog(input.board.log) },
        input.message,
      ),
    });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: first }];
    const usage: Usage = { input_tokens: 0, output_tokens: 0 };
    let acted = false;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = this.client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: { effort: EFFORT },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          tools: BOARD_TOOLS,
          system: [{ type: "text", text: BOARD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages,
        });
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "thinking") yield { type: "status", stage: "thinking" };
            else if (event.content_block.type === "text" || event.content_block.type === "tool_use")
              yield { type: "status", stage: "writing" };
          }
        }
        const final = await stream.finalMessage();
        usage.input_tokens += final.usage.input_tokens;
        usage.output_tokens += final.usage.output_tokens;
        if (final.stop_reason === "refusal") {
          yield { type: "error", message: "Claude declined this request. Try rewording it." };
          return;
        }
        const calls = final.content.filter((b) => b.type === "tool_use");
        const text = final.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));
        if (!calls.length) {
          // Text outside the tools isn't shown on the board; if Claude only wrote text, it becomes a note.
          if (!acted && text.length) {
            const r = await input.runTool("add_note", { text: text.join("\n\n").slice(0, 4000) });
            yield { type: "tool", name: "add_note", ok: !r.isError, text: r.text };
          }
          if (final.stop_reason === "max_tokens") yield { type: "tool", name: "", ok: false, text: "Claude's answer was cut off." };
          break;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          if (call.type !== "tool_use") continue;
          const r = await input.runTool(call.name, call.input);
          if (!r.isError && call.name !== "get_board" && call.name !== "get_changelog") acted = true;
          yield { type: "tool", name: call.name, ok: !r.isError, text: r.text };
          results.push({ type: "tool_result", tool_use_id: call.id, content: r.text, is_error: r.isError });
        }
        // The assistant turn goes back unchanged (thinking included), then every result in one user message.
        messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
        messages.push({ role: "user", content: results });
      }
      yield { type: "done", usage, ms: Date.now() - start };
    } catch (err) {
      yield { type: "error", message: friendlyError(err) };
    }
  }

  private async *run(userText: string): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    try {
      const stream = this.client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userText }],
      });
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "thinking") yield { type: "status", stage: "thinking" };
          else if (event.content_block.type === "text") yield { type: "status", stage: "writing" };
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "max_tokens") {
        yield { type: "error", message: "The simulation was too long and got cut off. Try a simpler request." };
        return;
      }
      if (final.stop_reason === "refusal") {
        yield { type: "error", message: "Claude declined this request. Try rewording it." };
        return;
      }
      const u = final.usage;
      const usage: Usage = {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens ?? undefined,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? undefined,
      };
      yield { type: "done", stopReason: final.stop_reason, usage, ms: Date.now() - start };
    } catch (err) {
      yield { type: "error", message: friendlyError(err) };
    }
  }
}

export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check .env.local.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (err instanceof Anthropic.NotFoundError) return "The model wasn't found for this API key.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is busy right now (rate limited). Try again in a moment.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Claude is overloaded or having trouble. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the network connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? "?"}).`;
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to Claude.";
}
