import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, MAX_TOKENS, MODEL } from "../config";
import {
  SYSTEM_PROMPT,
  editMessage,
  generateMessage,
  homeworkMessage,
  repairMessage,
} from "../prompts";
import type { Homework, HomeworkInput, SimModel, StreamEvent, Usage } from "../types";

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
