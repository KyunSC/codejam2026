import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import {
  checkArithmeticLine,
  checkArithmeticSubtotal,
  checkArithmeticTotal,
  checkDateAmbiguous,
  checkDateOdd,
  checkFieldUncertain,
  checkFxRateFallback,
  checkShipToUnknown,
  checkTermsMismatch,
  checkUnreadable,
} from "../checks/reading";
import { D, fresh, history, refs } from "./fixtures";

type Row = [string, ResolvedInvoice, Array<{ code: string; effect: string }>];
const run = (check: (i: ResolvedInvoice, r: typeof refs) => Array<{ code: string; effect: string }>) =>
  (_: string, invoice: ResolvedInvoice, want: Array<{ code: string; effect: string }>) => {
    const flags = check(invoice, refs);
    expect(flags.map((f) => ({ code: f.code, effect: f.effect }))).toEqual(want);
    for (const f of flags as unknown as Array<{ message: string; evidence: unknown[] }>) {
      expect(f.message.length).toBeGreaterThan(20);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  };

const clean = fresh("V012");
const lineWith = (q: string, p: string, a: string) => [{ ...clean.lines[0], quantity: D(q), unitPrice: D(p), amount: D(a) }];

describe("UNREADABLE", () => {
  it.each<Row>([
    ["clean invoice", clean, []],
    ["no amounts at all", fresh("V012", { total: null, subtotal: null, lines: [] }), [{ code: "UNREADABLE", effect: "hold" }]],
    ["no vendor, number or total", fresh("V012", { vendorName: null, invoiceNumber: null, total: null }), [{ code: "UNREADABLE", effect: "hold" }]],
    ["not an invoice", fresh("V012", { extracted: { ...clean.extracted, docType: "other" } }), [{ code: "UNREADABLE", effect: "hold" }]],
  ])("%s", run(checkUnreadable));
});

describe("FIELD_UNCERTAIN", () => {
  it.each<Row>([
    ["all required fields confirmed", clean, []],
    ["missing invoice number", fresh("V012", { invoiceNumber: null }), [{ code: "FIELD_UNCERTAIN", effect: "hold" }]],
    ["total uncertain on a scan", fresh("V012", { evidence: { total: "uncertain" } }), [{ code: "FIELD_UNCERTAIN", effect: "hold" }]],
    ["not in text layer is not uncertain", fresh("V012", { evidence: { total: "not_in_text" } }), []],
    ["unusable file: left to UNREADABLE", fresh("V012", { total: null, subtotal: null, lines: [] }), []],
  ])("%s", run(checkFieldUncertain));
});

describe("ARITHMETIC_LINE", () => {
  it.each<Row>([
    ["24 × $150.00 printed as $3,800.00", fresh("V012", { lines: lineWith("24", "150.00", "3800.00") }), [{ code: "ARITHMETIC_LINE", effect: "hold" }]],
    ["24 × $150.00 = $3,600.00", fresh("V012", { lines: lineWith("24", "150.00", "3600.00") }), []],
    ["within $0.02", fresh("V012", { lines: lineWith("3", "33.333", "100.01") }), []],
    ["no unit price printed", fresh("V012", { lines: [{ ...clean.lines[0], unitPrice: null }] }), []],
  ])("%s", run(checkArithmeticLine));
});

describe("ARITHMETIC_SUBTOTAL", () => {
  it.each<Row>([
    ["lines sum to subtotal", clean, []],
    ["subtotal off by $10", fresh("V012", { subtotal: clean.subtotal!.plus(10), lines: clean.lines }), [{ code: "ARITHMETIC_SUBTOTAL", effect: "hold" }]],
    ["a line amount missing", fresh("V012", { lines: [{ ...clean.lines[0], amount: null }], subtotal: D(5) }), []],
  ])("%s", run(checkArithmeticSubtotal));
});

describe("ARITHMETIC_TOTAL", () => {
  const sub = D("3180.00");
  const tax = [{ labelPrinted: "GST (5%)", taxCode: "GST5" as const, ratePrinted: D("0.05"), amount: D("159.00") }];
  it.each<Row>([
    ["$3,180.00 + $159.00 printed as $3,439.00", fresh("V012", { subtotal: sub, taxes: tax, total: D("3439.00") }), [{ code: "ARITHMETIC_TOTAL", effect: "hold" }]],
    ["$3,180.00 + $159.00 = $3,339.00", fresh("V012", { subtotal: sub, taxes: tax, total: D("3339.00") }), []],
    ["credit note adds up", fresh("V012", { subtotal: D("-640.00"), taxes: [{ ...tax[0], amount: D("-32.00") }], total: D("-672.00") }), []],
  ])("%s", run(checkArithmeticTotal));
});

describe("DATE_ODD", () => {
  it.each<Row>([
    ["normal dates", fresh("V012", { invoiceDate: "2026-10-28", receivedDate: "2026-10-29", dueDate: "2026-11-27" }), []],
    ["dated 2026-08-12, received 2026-10-29", fresh("V012", { invoiceDate: "2026-08-12", receivedDate: "2026-10-29" }), [{ code: "DATE_ODD", effect: "info" }]],
    ["exactly 60 days old", fresh("V012", { invoiceDate: "2026-08-30", receivedDate: "2026-10-29" }), []],
    ["due before invoice date", fresh("V012", { invoiceDate: "2026-10-28", dueDate: "2026-10-01" }), [{ code: "DATE_ODD", effect: "info" }]],
    ["dated after receipt, not future", fresh("V012", { invoiceDate: "2026-10-30", receivedDate: "2026-10-29" }), [{ code: "DATE_ODD", effect: "info" }]],
    ["dated in the future", fresh("V012", { invoiceDate: "2026-12-15", receivedDate: "2026-10-29" }), [{ code: "DATE_ODD", effect: "hold" }]],
    [
      "due date ≠ date + printed terms",
      fresh("V012", { invoiceDate: "2026-10-01", dueDate: "2026-10-20", terms: { raw: "Net 30", netDays: 30, discountPct: null, discountDays: null } }),
      [{ code: "DATE_ODD", effect: "info" }],
    ],
    [
      "due date = date + printed terms",
      fresh("V012", { invoiceDate: "2026-10-01", dueDate: "2026-10-31", terms: { raw: "Net 30", netDays: 30, discountPct: null, discountDays: null } }),
      [],
    ],
  ])("%s", run(checkDateOdd));
});

describe("DATE_AMBIGUOUS", () => {
  it.each<Row>([
    ["no parse issue", clean, []],
    [
      "03/04/2026",
      fresh("V012", { parseIssues: [{ field: "invoiceDate", code: "DATE_AMBIGUOUS", raw: "03/04/2026", detail: "2026-04-03 or 2026-03-04" }] }),
      [{ code: "DATE_AMBIGUOUS", effect: "hold" }],
    ],
    ["other parse issue", fresh("V012", { parseIssues: [{ field: "total", code: "AMOUNT_UNPARSEABLE", raw: "x", detail: "x" }] }), []],
  ])("%s", run(checkDateAmbiguous));
});

describe("TERMS_MISMATCH", () => {
  const v = refs.vendors.get("V012")!;
  const terms = (n: number) => ({ raw: `Net ${n}`, netDays: n, discountPct: null, discountDays: null });
  it.each<Row>([
    ["printed terms equal the vendor's", fresh("V012", { terms: terms(v.paymentTermsDays) }), []],
    ["printed terms differ", fresh("V012", { terms: terms(v.paymentTermsDays + 15) }), [{ code: "TERMS_MISMATCH", effect: "info" }]],
    ["no terms printed, due date gap differs", fresh("V012", { invoiceDate: "2026-10-01", dueDate: "2026-10-05" }), [{ code: "TERMS_MISMATCH", effect: "info" }]],
    ["unknown vendor", fresh("V012", { vendorId: null, terms: terms(99) }), []],
  ])("%s", run(checkTermsMismatch));

  it("never fires on history (due − invoice date equals the vendor's terms on all 426)", () => {
    for (const r of history.resolved.values()) expect(checkTermsMismatch(r, refs)).toEqual([]);
  });
});

describe("FX_RATE_FALLBACK", () => {
  it.each<Row>([
    ["USD dated after the last rate", fresh("V016", { currencyResolved: "USD", invoiceDate: "2026-11-10" }), [{ code: "FX_RATE_FALLBACK", effect: "info" }]],
    ["USD within the table", fresh("V016", { currencyResolved: "USD", invoiceDate: "2026-10-10" }), []],
    ["CAD after the last rate", fresh("V012", { invoiceDate: "2026-11-10" }), []],
  ])("%s", run(checkFxRateFallback));
});

describe("SHIP_TO_UNKNOWN", () => {
  it.each<Row>([
    ["one of the four offices", clean, []],
    ["unknown bill-to", fresh("V012", { shipToProvince: null, billToAddress: "1 Main St, Halifax NS" }), [{ code: "SHIP_TO_UNKNOWN", effect: "hold" }]],
  ])("%s", run(checkShipToUnknown));
});

describe("history is clean for reading checks", () => {
  it("no reading or arithmetic flag on any of the 426 history invoices", () => {
    const all = [checkUnreadable, checkFieldUncertain, checkArithmeticLine, checkArithmeticSubtotal, checkArithmeticTotal, checkShipToUnknown, checkFxRateFallback];
    for (const [id, r] of history.resolved) {
      expect(all.flatMap((c) => c(r, refs)).map((f) => `${id} ${f.code}`)).toEqual([]);
    }
  });
});
