import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { config } from "../../../config";
import type { Extracted } from "../../../types";
import { loadRecordedAnswers } from "../recorded";
import { buildRequest, ClaudeExtractor, EXTRACTED_SCHEMA, validateExtracted, type CreateMessage } from "../claude";
import { createExtractor } from "../index";
import { MemoryExtractionCache } from "../cache";

const recorded = [...loadRecordedAnswers().values()];
const pdfAnswer = recorded.find((a) => a.file.endsWith(".pdf") && a.purpose?.startsWith("English"))!.extracted;
const scanAnswer = recorded.find((a) => a.file.endsWith(".png"))!.extracted;

function message(body: unknown, over: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: config.models.extraction,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  } as unknown as BetaMessage;
}

/** A fake client that answers from a list and records what it was sent. */
function fake(...answers: Array<BetaMessage | Error>) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    sent.push(params);
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  };
  return { create, sent };
}

const pdf = {
  sha256: "c".repeat(64),
  bytes: new Uint8Array([37, 80, 68, 70]),
  mime: "application/pdf",
  hasTextLayer: true,
};
const png = {
  sha256: "d".repeat(64),
  bytes: new Uint8Array([137, 80, 78, 71]),
  mime: "image/png",
  hasTextLayer: false,
};

describe("the request", () => {
  it("sends the PDF as a document with the schema as the output format and server-side fallbacks", () => {
    const r = buildRequest(pdf, "claude-sonnet-5-5", false);
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.output_config).toEqual({ format: { type: "json_schema", schema: EXTRACTED_SCHEMA } });
    expect(r.tool_choice).toBeUndefined();
    expect(r.fallbacks).toBe("default");
    expect(r.betas).toEqual(["server-side-fallback-2026-07-01"]);
    const content = r.messages[0].content as Array<{ type: string; source?: { media_type: string; data: string } }>;
    expect(content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf", data: "JVBERg==" } });
    expect(String(r.system)).toMatch(/bill-to block .* never the vendor's/);
  });

  it("sends an image as an image block, and refuses other types", () => {
    const content = buildRequest(png, "m", false).messages[0].content as Array<{ type: string }>;
    expect(content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
    expect(() => buildRequest({ ...png, mime: "image/tiff" }, "m", false)).toThrow(/image\/tiff/);
  });

  it("uses the configured extraction model by default", async () => {
    const { create, sent } = fake(message(pdfAnswer));
    await new ClaudeExtractor(create).extract(pdf);
    expect(sent[0].model).toBe(config.models.extraction);
  });

  it("has a schema whose every object is closed and fully required", () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(s.required).toEqual(Object.keys(s.properties as object));
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(walk);
      }
      if (s.type === "array") walk(s.items as Record<string, unknown>);
    };
    walk(EXTRACTED_SCHEMA);
  });
});

describe("ClaudeExtractor", () => {
  it("returns a valid answer as a real one", async () => {
    const { create, sent } = fake(message(pdfAnswer));
    const r = await new ClaudeExtractor(create).extract(pdf);
    expect(r).toMatchObject({ ok: true, source: "claude", model: config.models.extraction, secondRead: null });
    expect(sent).toHaveLength(1);
  });

  it("does not read a PDF with a text layer twice even when its sums are off", async () => {
    const off: Extracted = { ...pdfAnswer, total: "$999.99" };
    const { create, sent } = fake(message(off));
    await new ClaudeExtractor(create).extract(pdf);
    expect(sent).toHaveLength(1);
  });

  it("does not read a scan twice when its arithmetic closes", async () => {
    const { create, sent } = fake(message(scanAnswer));
    expect(await new ClaudeExtractor(create).extract(png)).toMatchObject({ ok: true, secondRead: null });
    expect(sent).toHaveLength(1);
  });

  it("reads a scan a second time when its arithmetic does not close", async () => {
    const misread: Extracted = { ...scanAnswer, total: "$6,698.69" };
    const { create, sent } = fake(message(misread), message(scanAnswer));
    const r = await new ClaudeExtractor(create).extract(png);
    expect(r).toMatchObject({ ok: true, extracted: { total: "$6,698.69" }, secondRead: { total: "$6,693.69" } });
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1].messages)).toMatch(/second, independent reading/);
  });

  it("keeps the first read when the second fails", async () => {
    const misread: Extracted = { ...scanAnswer, total: "$6,698.69" };
    const { create } = fake(message(misread), new Error("network"));
    expect(await new ClaudeExtractor(create).extract(png)).toMatchObject({ ok: true, secondRead: null });
  });

  it.each([
    ["a refusal", message("", { stop_reason: "refusal" }), "api_error", /declined/],
    ["a cut-off answer", message("{", { stop_reason: "max_tokens" }), "bad_answer", /cut off/],
    ["text that is not JSON", message("I see an invoice."), "bad_answer", /not JSON/],
    ["JSON of the wrong shape", message({ ...pdfAnswer, lines: [{ amount: 5 }] }), "bad_answer", /schema \(lines\)/],
    [
      "an API error",
      new Anthropic.APIError(529, undefined, "Overloaded", new Headers()),
      "api_error",
      /failed \(529\)/,
    ],
  ])("names %s as a failure instead of throwing", async (_, answer, reason, detail) => {
    const { create } = fake(answer);
    const r = await new ClaudeExtractor(create).extract(pdf);
    expect(r).toMatchObject({ ok: false, reason });
    expect(!r.ok && r.detail).toMatch(detail);
  });
});

describe("validateExtracted", () => {
  it("accepts every hand-made fixture and rejects broken shapes", () => {
    for (const a of recorded) expect(validateExtracted(a.extracted)).toBeNull();
    expect(validateExtracted({ ...pdfAnswer, docType: "receipt" })).toBe("docType");
    expect(validateExtracted({ ...pdfAnswer, total: 612.64 })).toBe("total");
    expect(validateExtracted({ ...pdfAnswer, unreadable: undefined })).toBe("unreadable");
  });
});

describe("createExtractor with a key", () => {
  it("builds the Claude extractor and caches its answer", async () => {
    const { create, sent } = fake(message(pdfAnswer));
    const cache = new MemoryExtractionCache();
    const x = createExtractor({
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      cache,
      claude: () => new ClaudeExtractor(create),
    });
    await x.extract(pdf);
    expect(await x.extract(pdf)).toMatchObject({ ok: true, source: "cache" });
    expect(sent).toHaveLength(1);
    expect(cache.get(pdf.sha256)?.model).toBe(config.models.extraction);
  });
});
