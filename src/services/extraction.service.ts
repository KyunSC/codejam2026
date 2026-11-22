import Anthropic from "@anthropic-ai/sdk";
import { NotSetUpError } from "@/lib/errors";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { InvoiceData } from "@/lib/types";

export const EXTRACTION_MODEL = "claude-haiku-5-5";

const money = z.number().nullable();
// Text the document may not print: an empty string then. Plain strings, not nullable ones, because structured output allows
// at most 16 nullable or union-typed fields in a schema; toInvoiceData turns "" back into null.
const text = z.string();

const ExtractedDocument = z.object({
  is_invoice: z.boolean().describe("true for an invoice or credit note"),
  not_invoice_reason: text.describe("why it is not an invoice; empty for an invoice"),
  language: z.enum(["en", "fr"]),
  document_type: z.enum(["invoice", "credit_note"]),
  vendor_name: text.describe("empty when not printed"),
  vendor_address: text.describe("empty when not printed"),
  vendor_gst_hst_number: text.describe("empty when not printed"),
  vendor_qst_number: text.describe("empty when not printed"),
  vendor_invoice_number: text.describe("empty when not printed"),
  invoice_date: text.describe("YYYY-MM-DD; empty when not printed"),
  due_date: text.describe("YYYY-MM-DD; empty when not printed"),
  payment_terms: text.describe("empty when not printed"),
  po_reference: text.describe("empty when not printed"),
  credit_note_reference: text.describe("the invoice a credit note refers to; empty when not printed"),
  bill_to_name: text.describe("empty when not printed"),
  bill_to_address: text.describe("empty when not printed"),
  bill_to_tax_number: text.describe("empty when not printed"),
  currency: z.string().describe("ISO code, e.g. CAD or USD"),
  lines: z.array(z.object({ description: z.string(), quantity: z.number(), unit_price: z.number(), amount: z.number() })),
  subtotal: money,
  taxes: z.array(z.object({ label: z.string(), rate: z.number().nullable().describe("as a fraction, e.g. 0.05"), amount: z.number() })),
  total: money,
  remit_institution: text.describe("empty when not printed"),
  remit_transit: text.describe("empty when not printed"),
  remit_account: text.describe("empty when not printed"),
  remit_note: text.describe("empty when not printed"),
});

export type Extracted = z.infer<typeof ExtractedDocument>;

const EmailClass = z.object({
  category: z.enum(["missing_attachment", "payment_inquiry", "statement", "marketing", "other"]),
  reason: z.string(),
});

let anthropic: Anthropic | null = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new NotSetUpError("Reading documents is not set up: ANTHROPIC_API_KEY is missing on the server.");
  return (anthropic ??= new Anthropic());
};

// The email a document came attached to.
export type EmailContext = { from: string | null; subject: string | null; body: string | null };

// Reads one PDF or scanned image into the fixed invoice shape. For an attachment, the email it came with is given alongside.
export async function extractDocument(kind: "pdf" | "png" | "jpeg", bytes: Buffer, email?: EmailContext): Promise<Extracted> {
  const data = bytes.toString("base64");
  const block: Anthropic.ContentBlockParam =
    kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: kind === "png" ? "image/png" : "image/jpeg", data } };
  const response = await getClient().messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          block,
          ...(email
            ? [{ type: "text" as const, text: `It came attached to this email.\n\nFrom: ${email.from ?? ""}\nSubject: ${email.subject ?? ""}\n\n${email.body ?? ""}` }]
            : []),
          {
            type: "text",
            text: "This document arrived in a Canadian company's accounts payable inbox. Read it into the given fields, with amounts as plain numbers, dates as YYYY-MM-DD, and each line and tax line as printed. Where the email adds to the document, such as the invoice a credit note refers to or a PO number, include it in the fields.",
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ExtractedDocument) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Extraction returned no result (${response.stop_reason})`);
  }
  return response.parsed_output;
}

// For an email with nothing attached: what it is, in one line for the clerk.
export async function classifyEmail(subject: string, body: string): Promise<{ category: string; reason: string }> {
  const response = await getClient().messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(EmailClass) },
    messages: [{ role: "user", content: `An email with no attachment reached the accounts payable inbox.\n\nSubject: ${subject}\n\n${body}\n\nClassify it and give a one-line reason for the AP clerk.` }],
  });
  return response.parsed_output ?? { category: "other", reason: "No attachment" };
}

// An empty string from the reading is a field the document doesn't print.
// (The stand-in reader, scripts/reader.ts, still answers null for these.)
const orNull = (v: string | null) => (v?.trim() ? v : null);

export function toInvoiceData(e: Extracted): InvoiceData {
  return {
    document_type: e.document_type,
    vendor_name: orNull(e.vendor_name),
    vendor_address: orNull(e.vendor_address),
    vendor_gst_hst_number: orNull(e.vendor_gst_hst_number),
    vendor_qst_number: orNull(e.vendor_qst_number),
    vendor_invoice_number: orNull(e.vendor_invoice_number),
    invoice_date: orNull(e.invoice_date),
    due_date: orNull(e.due_date),
    payment_terms: orNull(e.payment_terms),
    po_reference: orNull(e.po_reference),
    credit_note_reference: orNull(e.credit_note_reference),
    bill_to_name: orNull(e.bill_to_name),
    bill_to_address: orNull(e.bill_to_address),
    bill_to_tax_number: orNull(e.bill_to_tax_number),
    currency: (e.currency || "CAD").toUpperCase(),
    subtotal: e.subtotal,
    taxes: e.taxes,
    total: e.total,
    remit_institution: orNull(e.remit_institution),
    remit_transit: orNull(e.remit_transit),
    remit_account: orNull(e.remit_account),
    remit_note: orNull(e.remit_note),
    lines: e.lines.map((l, i) => ({ line_no: i + 1, ...l })),
  };
}
