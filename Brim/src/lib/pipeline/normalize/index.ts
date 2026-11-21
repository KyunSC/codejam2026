/**
 * normalize(extracted, ctx) → NormalizedInvoice (BUILD_PLAN "Normalisation" + field evidence).
 *
 * Assembles the parsers (amounts, dates, tax labels, terms, currency, number keys) and the
 * evidence. Values that do not parse become null with a ParseIssue; nothing throws.
 *
 * Credit notes are negative: when a credit note's total is printed positive, every money field
 * (line amounts and unit prices, subtotal, taxes, total) is negated so the credit nets against
 * the invoice. Quantities keep their sign. Evidence always works on the printed values.
 *
 * FX and the vendor are not here: they are Resolution (Loop B), which reads `currency`.
 */
import type Decimal from "decimal.js";
import type { Extracted, NormalizedInvoice, NormalizedLine, NormalizedTax, ParseIssue, IsoDate } from "../../types";
import { computeEvidence, type EvidenceResult } from "../evidence";
import { parseAmount } from "./amount";
import { currencyFromLabel } from "./currency";
import { parseDate } from "./date";
import { invoiceNumberKeys } from "./invoice-number";
import { normalizeTaxLabel } from "./tax-label";
import { normalizeTerms } from "./terms";

export interface NormalizeContext {
  fileSha256: string;
  textLayer: string | null;
  hasTextLayer: boolean;
  receivedDate: IsoDate;
  emailId?: string | null;
  senderAddress?: string | null;
  senderName?: string | null;
  /** A second read of a scan, used only when its arithmetic does not close. */
  secondRead?: Extracted | null;
}

export interface NormalizeResult {
  invoice: NormalizedInvoice;
  needsReview: boolean;
  reviewFields: EvidenceResult["reviewFields"];
  arithmetic: EvidenceResult["arithmetic"];
}

const blank = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

export function normalizeDetailed(x: Extracted, ctx: NormalizeContext): NormalizeResult {
  const issues: ParseIssue[] = [];
  const amount = (raw: string | null, field: string): Decimal | null => {
    const r = parseAmount(raw, field);
    if (r === null) return null;
    if (!r.ok) {
      issues.push(r.issue);
      return null;
    }
    return r.value;
  };
  const date = (raw: string | null, field: string): IsoDate | null => {
    const r = parseDate(raw, field);
    if (r === null) return null;
    if (!r.ok) {
      issues.push(r.issue);
      return null;
    }
    return r.value;
  };

  const kind = x.docType === "credit_note" ? "credit_note" : "invoice";

  let lines: NormalizedLine[] = x.lines.map((l, i) => ({
    lineNo: i + 1,
    description: l.description,
    quantity: amount(l.quantity, `lines.${i}.quantity`),
    unitPrice: amount(l.unitPrice, `lines.${i}.unitPrice`),
    amount: amount(l.amount, `lines.${i}.amount`),
  }));
  let taxes: NormalizedTax[] = [];
  x.taxes.forEach((t, i) => {
    const label = normalizeTaxLabel(t.label, `taxes.${i}.label`);
    if (label.issue) issues.push(label.issue);
    const value = amount(t.amount, `taxes.${i}.amount`);
    if (value === null) return; // unparseable amount already raised an issue
    taxes.push({ labelPrinted: t.label, taxCode: label.taxCode, ratePrinted: label.ratePrinted, amount: value });
  });
  let subtotal = amount(x.subtotal, "subtotal");
  let total = amount(x.total, "total");

  if (kind === "credit_note" && total?.isPositive() && !total.isZero()) {
    const neg = (d: Decimal | null) => (d === null ? null : d.negated());
    lines = lines.map((l) => ({ ...l, unitPrice: neg(l.unitPrice), amount: neg(l.amount) }));
    taxes = taxes.map((t) => ({ ...t, amount: t.amount.negated() }));
    subtotal = neg(subtotal);
    total = neg(total);
  }

  const keys = invoiceNumberKeys(blank(x.invoiceNumber));
  const ev = computeEvidence(x, {
    textLayer: ctx.textLayer,
    hasTextLayer: ctx.hasTextLayer,
    secondRead: ctx.secondRead,
  });

  const invoice: NormalizedInvoice = {
    kind,
    language: x.language,
    fileSha256: ctx.fileSha256,
    hasTextLayer: ctx.hasTextLayer,
    receivedDate: ctx.receivedDate,
    emailId: ctx.emailId ?? null,
    senderAddress: ctx.senderAddress ?? null,
    senderName: ctx.senderName ?? null,
    vendorName: blank(x.vendor.name),
    vendorAddress: blank(x.vendor.address),
    gstHstNumber: blank(x.vendor.gstHstNumber),
    qstNumber: blank(x.vendor.qstNumber),
    billToAddress: blank(x.billTo.address),
    invoiceNumber: blank(x.invoiceNumber),
    numberKey: keys.numberKey,
    digitsKey: keys.digitsKey,
    invoiceDate: date(x.invoiceDate, "invoiceDate"),
    dueDate: date(x.dueDate, "dueDate"),
    terms: normalizeTerms(x.terms),
    poNumber: blank(x.poNumber),
    creditNoteRef: blank(x.creditNoteRef),
    currency: currencyFromLabel(x.currency),
    lines,
    subtotal,
    taxes,
    total,
    remit: {
      institution: blank(x.remit.institution),
      transit: blank(x.remit.transit),
      account: blank(x.remit.account),
      text: blank(x.remit.text),
    },
    notes: x.notes,
    evidence: ev.evidence,
    parseIssues: issues,
    extracted: x,
  };
  return { invoice, needsReview: ev.needsReview, reviewFields: ev.reviewFields, arithmetic: ev.arithmetic };
}

export function normalize(x: Extracted, ctx: NormalizeContext): NormalizedInvoice {
  return normalizeDetailed(x, ctx).invoice;
}
