/**
 * Turns history rows (invoices.csv + invoice_lines.csv) into the shapes the rules engine reads:
 * `KnownInvoice` (what later invoices are compared against) and `ResolvedInvoice` (what the checks
 * take), so the same checks run over the ten months of history as over the incoming batch
 * (BUILD_PLAN "Decisions already made": the checks engine also runs over history).
 *
 * History stores resolved values directly, so the adapter fills `ResolvedInvoice` as if the
 * document had printed exactly what the CSV holds. What history does not record is left empty:
 * - remittance details (so BANK_MISMATCH cannot fire on history),
 * - printed terms: rebuilt as `Net N` from due date − invoice date.
 */
import type Decimal from "decimal.js";
import type { Dataset, InvoiceLineRow, InvoiceRow, VendorRow } from "../dataset";
import { daysBetween } from "../today";
import type { Extracted, NormalizedTax, ResolvedInvoice, ResolvedLine, TaxCode } from "../types";
import { digitsKey, numberKey } from "./keys";
import { officeAddress } from "./offices";
import type { KnownInvoice } from "./refs";

const TAX_LABEL: Partial<Record<TaxCode, string>> = {
  HST13: "HST",
  GST5: "GST",
  PST7_BC: "PST",
  QST9975: "QST",
};

/** Lines grouped by invoice id, in line order. */
export function linesByInvoice(lines: readonly InvoiceLineRow[]): Map<string, InvoiceLineRow[]> {
  const out = new Map<string, InvoiceLineRow[]>();
  for (const l of lines) {
    const list = out.get(l.invoiceId);
    if (list) list.push(l);
    else out.set(l.invoiceId, [l]);
  }
  for (const list of out.values()) list.sort((a, b) => a.lineNo - b.lineNo);
  return out;
}

/** The single code of a kind that the lines carry, if any (the most frequent on a tie-free invoice). */
function lineCode(lines: readonly InvoiceLineRow[], pick: (l: InvoiceLineRow) => TaxCode | null): TaxCode | null {
  const counts = new Map<TaxCode, number>();
  for (const l of lines) {
    const c = pick(l);
    if (c && TAX_LABEL[c]) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: TaxCode | null = null;
  for (const [c, n] of counts) if (best === null || n > counts.get(best)!) best = c;
  return best;
}

/** The tax lines as they would have been printed, from the invoice amounts and the line codes. */
export function historyTaxes(
  inv: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  rates: ReadonlyMap<TaxCode, Decimal>,
): NormalizedTax[] {
  const out: NormalizedTax[] = [];
  const add = (amount: Decimal, code: TaxCode | null) => {
    if (amount.isZero() || !code) return;
    const rate = rates.get(code) ?? null;
    out.push({
      labelPrinted: `${TAX_LABEL[code]} (${rate ? rate.mul(100).toString() : "?"}%)`,
      taxCode: code,
      ratePrinted: rate,
      amount,
    });
  };
  add(inv.gstHstAmount, lineCode(lines, (l) => l.gstHstCode));
  add(inv.pstQstAmount, lineCode(lines, (l) => l.pstQstCode));
  return out;
}

export function toKnownInvoice(inv: InvoiceRow, lines: readonly InvoiceLineRow[]): KnownInvoice {
  return {
    invoiceId: inv.invoiceId,
    kind: inv.total.isNegative() ? "credit_note" : "invoice",
    vendorId: inv.vendorId,
    invoiceNumber: inv.vendorInvoiceNumber,
    numberKey: numberKey(inv.vendorInvoiceNumber),
    digitsKey: digitsKey(inv.vendorInvoiceNumber),
    invoiceDate: inv.invoiceDate,
    receivedDate: inv.receivedDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    subtotal: inv.subtotal,
    total: inv.total,
    totalCad: inv.totalCad,
    status: inv.status,
    poId: inv.poId,
    contractId: inv.contractId,
    departmentId: inv.departmentId,
    requesterId: inv.requesterUserId,
    shipToProvince: inv.shipToProvince,
    lines: lines.map((l) => ({
      description: l.description,
      amount: l.amount,
      glAccount: l.glAccount,
      departmentId: l.departmentId,
      lineType: l.lineType,
      taxCodes: [l.gstHstCode, l.pstQstCode].filter((c): c is TaxCode => !!c),
    })),
  };
}

const str = (d: Decimal | null) => (d ? d.toFixed(2) : null);

export function toResolvedInvoice(
  inv: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  vendor: VendorRow | undefined,
  rates: ReadonlyMap<TaxCode, Decimal>,
): ResolvedInvoice {
  const taxes = historyTaxes(inv, lines, rates);
  const netDays = daysBetween(inv.invoiceDate, inv.dueDate);
  const resolvedLines: ResolvedLine[] = lines.map((l) => ({
    lineNo: l.lineNo,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    glAccount: l.glAccount,
    lineType: l.lineType,
    lineTypeSource: "account",
  }));
  const billTo = officeAddress(inv.shipToProvince);
  const extracted: Extracted = {
    docType: inv.total.isNegative() ? "credit_note" : "invoice",
    language: "en",
    vendor: {
      name: vendor?.legalName ?? null,
      address: vendor?.address ?? null,
      gstHstNumber: vendor?.gstHstNumber ?? null,
      qstNumber: vendor?.qstNumber ?? null,
    },
    billTo: { name: "Harborline Logistics", address: billTo },
    invoiceNumber: inv.vendorInvoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    terms: `Net ${netDays}`,
    poNumber: inv.poId,
    creditNoteRef: null,
    currency: inv.currency,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity.toString(),
      unitPrice: str(l.unitPrice),
      amount: str(l.amount),
    })),
    subtotal: str(inv.subtotal),
    taxes: taxes.map((t) => ({ label: t.labelPrinted, amount: t.amount.toFixed(2) })),
    total: str(inv.total),
    remit: { institution: null, transit: null, account: null, text: null },
    notes: [],
    unreadable: [],
  };
  const evidence: ResolvedInvoice["evidence"] = {};
  for (const k of ["vendorName", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "total", "billToAddress"]) {
    evidence[k] = "confirmed";
  }

  return {
    kind: extracted.docType === "credit_note" ? "credit_note" : "invoice",
    language: "en",
    fileSha256: `history:${inv.invoiceId}`,
    hasTextLayer: true,
    receivedDate: inv.receivedDate,
    emailId: null,
    senderAddress: null,
    senderName: null,
    vendorName: vendor?.legalName ?? null,
    vendorAddress: vendor?.address ?? null,
    gstHstNumber: vendor?.gstHstNumber ?? null,
    qstNumber: vendor?.qstNumber ?? null,
    billToAddress: billTo,
    invoiceNumber: inv.vendorInvoiceNumber,
    numberKey: numberKey(inv.vendorInvoiceNumber),
    digitsKey: digitsKey(inv.vendorInvoiceNumber),
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    terms: { raw: `Net ${netDays}`, netDays, discountPct: null, discountDays: null },
    poNumber: inv.poId,
    creditNoteRef: null,
    currency: inv.currency,
    lines: resolvedLines,
    subtotal: inv.subtotal,
    taxes,
    total: inv.total,
    remit: { institution: null, transit: null, account: null, text: null },
    notes: [],
    evidence,
    parseIssues: [],
    extracted,
    vendorId: inv.vendorId,
    vendorMatchedBy: vendor?.gstHstNumber ? "tax_number" : "name",
    vendorCandidates: [],
    shipToProvince: inv.shipToProvince,
    poId: inv.poId,
    poSuggestions: [],
    contractId: inv.contractId,
    departmentId: inv.departmentId,
    requesterId: inv.requesterUserId,
    creditOfInvoiceId: null,
    currencyResolved: inv.currency,
    fxRateToCad: inv.fxRateToCad,
    totalCad: inv.totalCad,
  };
}

/** Every history invoice in both shapes, keyed by invoice id. */
export function loadHistory(ds: Dataset): {
  known: KnownInvoice[];
  resolved: Map<string, ResolvedInvoice>;
} {
  const byInvoice = linesByInvoice(ds.invoiceLines);
  const vendors = new Map(ds.vendors.map((v) => [v.vendorId, v]));
  const rates = new Map(ds.taxCodes.map((t) => [t.code, t.rate] as const));
  const known: KnownInvoice[] = [];
  const resolved = new Map<string, ResolvedInvoice>();
  for (const inv of ds.invoices) {
    const lines = byInvoice.get(inv.invoiceId) ?? [];
    known.push(toKnownInvoice(inv, lines));
    resolved.set(inv.invoiceId, toResolvedInvoice(inv, lines, vendors.get(inv.vendorId), rates));
  }
  return { known, resolved };
}
