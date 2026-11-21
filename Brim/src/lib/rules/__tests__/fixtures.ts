/** Shared test fixtures: real reference data plus a clean history invoice to vary in table tests. */
import Decimal from "decimal.js";
import { loadDataset } from "../../dataset";
import { today } from "../../today";
import type { NormalizedTax, ResolvedInvoice, ResolvedLine } from "../../types";
import { loadHistory } from "../history";
import { buildRefs, type KnownInvoice, type Refs, withInvoices } from "../refs";

export const ds = loadDataset();
export const history = loadHistory(ds);
export const refs: Refs = buildRefs(ds, history.known, today());

export const D = (v: string | number) => new Decimal(v);

/** A history invoice as a ResolvedInvoice, with overrides applied. */
export function inv(id: string, over: Partial<ResolvedInvoice> = {}): ResolvedInvoice {
  const base = history.resolved.get(id);
  if (!base) throw new Error(`No history invoice ${id}`);
  // Decimals are immutable, so copying the containers is enough (structuredClone cannot copy Decimal).
  const copy: ResolvedInvoice = {
    ...base,
    lines: base.lines.map((l) => ({ ...l })),
    taxes: base.taxes.map((t) => ({ ...t })),
    evidence: { ...base.evidence },
    parseIssues: [...base.parseIssues],
  };
  return { ...copy, ...over };
}

/** A minimal clean CAD invoice for vendor `vendorId`, billed to Ontario, one services line. */
export function fresh(vendorId: string, over: Partial<ResolvedInvoice> = {}): ResolvedInvoice {
  const v = refs.vendors.get(vendorId)!;
  const amount = D(over.subtotal?.toString() ?? "1000.00");
  const lines: ResolvedLine[] = [
    { lineNo: 1, description: "Service", quantity: D(1), unitPrice: amount, amount, glAccount: v.defaultGlAccount, lineType: "services", lineTypeSource: "account" },
  ];
  const taxes: NormalizedTax[] = [{ labelPrinted: "HST (13%)", taxCode: "HST13", ratePrinted: D("0.13"), amount: amount.mul("0.13").toDecimalPlaces(2) }];
  const total = amount.plus(taxes[0].amount);
  const base = inv(history.known[0].invoiceId);
  return {
    ...base,
    fileSha256: "fresh",
    vendorId,
    vendorName: v.legalName,
    gstHstNumber: v.gstHstNumber,
    qstNumber: v.qstNumber,
    invoiceNumber: "T-1",
    numberKey: "T1",
    digitsKey: "1",
    invoiceDate: "2026-10-28",
    receivedDate: "2026-10-29",
    dueDate: null,
    terms: null,
    poNumber: null,
    poId: null,
    poSuggestions: [],
    contractId: refs.contractByVendor.get(vendorId)?.contractId ?? null,
    shipToProvince: "ON",
    billToAddress: "88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8",
    currency: "CAD",
    currencyResolved: "CAD",
    fxRateToCad: D(1),
    lines,
    subtotal: amount,
    taxes,
    total,
    totalCad: total,
    departmentId: "D01",
    requesterId: null,
    ...over,
  };
}

/** Refs with the given known invoices only. */
export function refsWith(known: KnownInvoice[], self: Refs["self"] = null): Refs {
  return withInvoices(refs, known, self);
}

/** Codes of the flags, for compact assertions. */
export const codes = (flags: Array<{ code: string }>) => flags.map((f) => f.code);

/** `[{code, effect}]` of the flags, after checking each has a sentence and evidence. */
export function summary(flags: Array<{ code: string; effect: string; message: string; evidence: unknown[] }>) {
  for (const f of flags) {
    if (f.message.length < 20) throw new Error(`${f.code}: message too short: ${f.message}`);
    if (!f.evidence.length) throw new Error(`${f.code}: no evidence`);
  }
  return flags.map((f) => ({ code: f.code, effect: f.effect }));
}
