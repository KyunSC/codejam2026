import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, MAX_TOKENS, MODEL } from "../config";
import { describeBoard, parseAction } from "../board";
import {
  BOARD_SYSTEM_PROMPT,
  BOARD_TOOLS,
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
  async *boardTurn(input: BoardTurnInput): AsyncGenerator<BoardEvent> {
    const start = Date.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: input.image } });
    content.push({ type: "text", text: boardMessage(describeBoard(input.items, input.view), input.message) });
    try {
      const stream = this.client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: BOARD_TOOLS,
        system: [{ type: "text", text: BOARD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "thinking") yield { type: "status", stage: "thinking" };
          else if (event.content_block.type === "text" || event.content_block.type === "tool_use")
            yield { type: "status", stage: "writing" };
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        yield { type: "error", message: "Claude declined this request. Try rewording it." };
        return;
      }
      let acted = false;
      const text: string[] = [];
      for (const block of final.content) {
        if (block.type === "text" && block.text.trim()) text.push(block.text.trim());
        if (block.type !== "tool_use") continue;
        const parsed = parseAction(block.name, block.input);
        if (parsed.ok) {
          acted = true;
          yield { type: "action", action: parsed.value };
        } else yield { type: "rejected", reason: parsed.reason };
      }
      // Text outside the tools is not shown on the board; if that's all Claude wrote, it becomes a note.
      if (!acted && text.length) {
        const note = parseAction("add_note", { text: text.join("\n\n").slice(0, 4000) });
        if (note.ok) yield { type: "action", action: note.value };
      }
      if (final.stop_reason === "max_tokens") yield { type: "rejected", reason: "Claude's answer was cut off." };
      const u = final.usage;
      yield {
        type: "done",
        usage: {
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          cache_read_input_tokens: u.cache_read_input_tokens ?? undefined,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? undefined,
        },
        ms: Date.now() - start,
      };
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
