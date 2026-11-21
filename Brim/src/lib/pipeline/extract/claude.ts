/**
 * The real extractor: one Claude call per file, the PDF or image sent as is, the answer
 * constrained to the `Extracted` schema (BUILD_PLAN "Extraction").
 *
 * BUILD_PLAN says "forced to answer through this schema". The extraction model (Sonnet 5.5)
 * rejects forced `tool_choice` with a 400, so the schema is enforced with structured outputs
 * (`output_config.format`), which constrains the reply to valid JSON for it. The answer is
 * still checked in code before use.
 *
 * Second read: a file with no text layer whose first read's arithmetic does not close is read
 * once more; evidence compares the two (evidence.ts).
 *
 * Refusals fall back server-side (`fallbacks: "default"`); a refusal of the whole chain, a
 * cut-off answer or an answer that does not fit the schema is a named failure, never a throw.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { config } from "../../config";
import type { Extracted } from "../../types";
import { checkArithmetic } from "../evidence";
import type { ExtractInput, ExtractResult, Extractor } from "./types";

/** The one call the extractor makes; the real client or a test double. */
export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

export function anthropicCreate(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey });
  return (params) => client.beta.messages.create(params);
}

const str = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** `Extracted` as a JSON schema. Every value is a string exactly as printed, or null. */
export const EXTRACTED_SCHEMA = obj({
  docType: { type: "string", enum: ["invoice", "credit_note", "statement", "other"] },
  language: { type: "string", enum: ["en", "fr"] },
  vendor: obj({ name: str, address: str, gstHstNumber: str, qstNumber: str }),
  billTo: obj({ name: str, address: str }),
  invoiceNumber: str,
  invoiceDate: str,
  dueDate: str,
  terms: str,
  poNumber: str,
  creditNoteRef: str,
  currency: str,
  lines: { type: "array", items: obj({ description: str, quantity: str, unitPrice: str, amount: str }) },
  subtotal: str,
  taxes: { type: "array", items: obj({ label: str, amount: str }) },
  total: str,
  remit: obj({ institution: str, transit: str, account: str, text: str }),
  notes: { type: "array", items: { type: "string" } },
  unreadable: { type: "array", items: { type: "string" } },
});

export const EXTRACTION_PROMPT = `You read one accounts-payable document (an invoice, credit note, statement or something else) and report what is printed on it, through the JSON schema.

Rules:
- Copy every value exactly as printed: keep the original number format ("1 014,18 $", "$1,014.18", "(226.00)"), date format, spelling, accents and punctuation. Do not convert, compute, round or translate anything.
- A field that is not printed is null. Never fill a field from arithmetic or from what is usual.
- vendor is the business that issued the document. Its GST/HST and QST numbers are the ones in its own block. The bill-to block often prints the customer's own GST/HST number: that is never the vendor's.
- currency is the currency word or symbol printed next to the total ("CAD", "USD", "$ CA"), or null when only "$" is printed.
- lines are the item rows in order. taxes are the tax rows in order with their labels as printed ("TPS (5 %)", "HST 13%").
- creditNoteRef is the original invoice a credit note refers to, if printed.
- remit holds the bank institution, transit and account numbers printed for payment, and text holds the payment instruction line as printed.
- notes are other printed remarks that matter for payment (discounts, late fees, "do not pay").
- language is "fr" when the labels are French, else "en".
- unreadable lists the field paths you cannot read with confidence (for example "total", "invoiceDate", "lines.2.amount"). Give your best reading in the field anyway when you can see one; use null only when nothing is legible.`;

const SECOND_READ_NOTE =
  "This is a second, independent reading of a scan whose figures did not add up on the first reading. Read every figure digit by digit.";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function fileBlock(input: ExtractInput) {
  const data = Buffer.from(input.bytes).toString("base64");
  if (input.mime === "application/pdf") {
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data },
    };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(input.mime)) {
    return { type: "image" as const, source: { type: "base64" as const, media_type: input.mime as ImageType, data } };
  }
  return null;
}

export function buildRequest(input: ExtractInput, model: string, secondRead: boolean): MessageCreateParamsNonStreaming {
  const file = fileBlock(input);
  if (!file) throw new Error(`Cannot send ${input.mime} to the model.`);
  return {
    model,
    max_tokens: 16000,
    system: EXTRACTION_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          file,
          { type: "text", text: secondRead ? `${SECOND_READ_NOTE}\nReport this document.` : "Report this document." },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: EXTRACTED_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

const isStr = (v: unknown) => v === null || typeof v === "string";
const hasStrs = (o: unknown, keys: string[]) =>
  typeof o === "object" && o !== null && keys.every((k) => isStr((o as Record<string, unknown>)[k]));

/** Checks the answer has the `Extracted` shape; returns a reason when it does not. */
export function validateExtracted(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "not an object";
  const x = v as Record<string, unknown>;
  if (!["invoice", "credit_note", "statement", "other"].includes(x.docType as string)) return "docType";
  if (x.language !== "en" && x.language !== "fr") return "language";
  if (!hasStrs(x.vendor, ["name", "address", "gstHstNumber", "qstNumber"])) return "vendor";
  if (!hasStrs(x.billTo, ["name", "address"])) return "billTo";
  for (const k of [
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "terms",
    "poNumber",
    "creditNoteRef",
    "currency",
    "subtotal",
    "total",
  ]) {
    if (!isStr(x[k])) return k;
  }
  if (!Array.isArray(x.lines) || !x.lines.every((l) => hasStrs(l, ["description", "quantity", "unitPrice", "amount"])))
    return "lines";
  if (!Array.isArray(x.taxes) || !x.taxes.every((t) => hasStrs(t, ["label", "amount"]))) return "taxes";
  if (!hasStrs(x.remit, ["institution", "transit", "account", "text"])) return "remit";
  if (!Array.isArray(x.notes) || !x.notes.every((n) => typeof n === "string")) return "notes";
  if (!Array.isArray(x.unreadable) || !x.unreadable.every((n) => typeof n === "string")) return "unreadable";
  return null;
}

type ReadResult = { ok: true; extracted: Extracted; model: string } | Extract<ExtractResult, { ok: false }>;

export class ClaudeExtractor implements Extractor {
  readonly kind = "claude" as const;

  constructor(
    private readonly create: CreateMessage,
    private readonly model: string = config.models.extraction,
  ) {}

  private async read(input: ExtractInput, secondRead: boolean): Promise<ReadResult> {
    let msg: BetaMessage;
    try {
      msg = await this.create(buildRequest(input, this.model, secondRead));
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? ` (${e.status})` : "";
      return { ok: false, reason: "api_error", detail: `The model call failed${status}: ${(e as Error).message}` };
    }
    if (msg.stop_reason === "refusal") {
      return { ok: false, reason: "api_error", detail: "The model declined to read this file." };
    }
    if (msg.stop_reason === "max_tokens") {
      return { ok: false, reason: "bad_answer", detail: "The model's answer was cut off." };
    }
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_answer", detail: "The model's answer was not JSON." };
    }
    const bad = validateExtracted(parsed);
    if (bad) return { ok: false, reason: "bad_answer", detail: `The model's answer does not fit the schema (${bad}).` };
    return { ok: true, extracted: parsed as Extracted, model: msg.model };
  }

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const first = await this.read(input, false);
    if (!first.ok) return first;
    let secondRead: Extracted | null = null;
    if (!input.hasTextLayer && !checkArithmetic(first.extracted).closes) {
      const again = await this.read(input, true);
      // A failed second read leaves the first standing; evidence then has nothing to compare.
      if (again.ok) secondRead = again.extracted;
    }
    return { ok: true, extracted: first.extracted, secondRead, source: "claude", model: first.model };
  }
}
