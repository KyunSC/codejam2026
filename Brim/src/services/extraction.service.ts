import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { InvoiceData } from "@/lib/types";

export const EXTRACTION_MODEL = "claude-haiku-5-5";

const money = z.number().nullable();

const ExtractedDocument = z.object({
  is_invoice: z.boolean().describe("true for an invoice or credit note"),
  not_invoice_reason: z.string().nullable(),
  language: z.enum(["en", "fr"]),
  document_type: z.enum(["invoice", "credit_note"]),
  vendor_name: z.string().nullable(),
  vendor_address: z.string().nullable(),
  vendor_gst_hst_number: z.string().nullable(),
  vendor_qst_number: z.string().nullable(),
  vendor_invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("YYYY-MM-DD"),
  due_date: z.string().nullable().describe("YYYY-MM-DD"),
  payment_terms: z.string().nullable(),
  po_reference: z.string().nullable(),
  credit_note_reference: z.string().nullable().describe("the invoice a credit note refers to"),
  bill_to_name: z.string().nullable(),
  bill_to_address: z.string().nullable(),
  bill_to_tax_number: z.string().nullable(),
  currency: z.string().describe("ISO code, e.g. CAD or USD"),
  lines: z.array(z.object({ description: z.string(), quantity: z.number(), unit_price: z.number(), amount: z.number() })),
  subtotal: money,
  taxes: z.array(z.object({ label: z.string(), rate: z.number().nullable().describe("as a fraction, e.g. 0.05"), amount: z.number() })),
  total: money,
  remit_institution: z.string().nullable(),
  remit_transit: z.string().nullable(),
  remit_account: z.string().nullable(),
  remit_note: z.string().nullable(),
});

export type Extracted = z.infer<typeof ExtractedDocument>;

const EmailClass = z.object({
  category: z.enum(["missing_attachment", "payment_inquiry", "statement", "marketing", "other"]),
  reason: z.string(),
});

let anthropic: Anthropic | null = null;
const getClient = () => (anthropic ??= new Anthropic());

// Reads one PDF or scanned image into the fixed invoice shape.
export async function extractDocument(kind: "pdf" | "png" | "jpeg", bytes: Buffer): Promise<Extracted> {
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
          {
            type: "text",
            text: "This document arrived in a Canadian company's accounts payable inbox. Read it into the given fields, with amounts as plain numbers, dates as YYYY-MM-DD, and each line and tax line as printed.",
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

export function toInvoiceData(e: Extracted): InvoiceData {
  return {
    document_type: e.document_type,
    vendor_name: e.vendor_name,
    vendor_address: e.vendor_address,
    vendor_gst_hst_number: e.vendor_gst_hst_number,
    vendor_qst_number: e.vendor_qst_number,
    vendor_invoice_number: e.vendor_invoice_number,
    invoice_date: e.invoice_date,
    due_date: e.due_date,
    payment_terms: e.payment_terms,
    po_reference: e.po_reference || null,
    credit_note_reference: e.credit_note_reference,
    bill_to_name: e.bill_to_name,
    bill_to_address: e.bill_to_address,
    bill_to_tax_number: e.bill_to_tax_number,
    currency: (e.currency || "CAD").toUpperCase(),
    subtotal: e.subtotal,
    taxes: e.taxes,
    total: e.total,
    remit_institution: e.remit_institution,
    remit_transit: e.remit_transit,
    remit_account: e.remit_account,
    remit_note: e.remit_note,
    lines: e.lines.map((l, i) => ({ line_no: i + 1, ...l })),
  };
}
