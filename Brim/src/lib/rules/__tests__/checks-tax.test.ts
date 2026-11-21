import { describe, expect, it } from "vitest";
import type { NormalizedTax, ResolvedInvoice, ResolvedLine, TaxCode } from "../../types";
import { checkCurrencyUnexpected, checkTaxAmount, checkTaxNotRegistered, checkTaxWrongForProvince } from "../checks/tax";
import { D, fresh, history, refs, summary } from "./fixtures";

type Want = Array<{ code: string; effect: string }>;
type Row = [string, ResolvedInvoice, Want];

const RATE: Record<string, string> = { HST13: "0.13", GST5: "0.05", PST7_BC: "0.07", QST9975: "0.09975" };
const LABEL: Record<string, string> = { HST13: "HST (13%)", GST5: "GST (5%)", PST7_BC: "PST (7%)", QST9975: "QST (9.975%)" };

/** An invoice for `vendorId` billed to `province`, with lines of the given types and taxes on the right bases. */
function billed(
  vendorId: string,
  province: "ON" | "AB" | "BC" | "QC" | null,
  lineTypes: Array<"goods" | "services" | null>,
  taxCodes: string[],
  over: Partial<ResolvedInvoice> = {},
): ResolvedInvoice {
  const lines: ResolvedLine[] = lineTypes.map((t, i) => ({
    lineNo: i + 1,
    description: `Line ${i + 1}`,
    quantity: D(1),
    unitPrice: D(1000),
    amount: D(1000),
    glAccount: "6110",
    lineType: t,
    lineTypeSource: t ? "account" : null,
  }));
  const subtotal = D(1000 * lines.length);
  const goods = D(1000 * lineTypes.filter((t) => t === "goods").length);
  const taxes: NormalizedTax[] = taxCodes.map((c) => ({
    labelPrinted: LABEL[c],
    taxCode: c as TaxCode,
    ratePrinted: D(RATE[c]),
    // PST on the goods lines; a vendor wrongly charging PST on services charges it on everything.
    amount: (c === "PST7_BC" && !goods.isZero() ? goods : subtotal).mul(RATE[c]).toDecimalPlaces(2),
  }));
  const total = taxes.reduce((s, t) => s.plus(t.amount), subtotal);
  return fresh(vendorId, { shipToProvince: province, lines, subtotal, taxes, total, totalCad: total, ...over });
}

const WRONG = [{ code: "TAX_WRONG_FOR_PROVINCE", effect: "hold" }];

describe("TAX_WRONG_FOR_PROVINCE", () => {
  it.each<Row>([
    ["ON with HST", billed("V012", "ON", ["services"], ["HST13"]), []],
    ["ON, no tax on $2,150.00 (like AP-00325)", billed("V012", "ON", ["services"], []), WRONG],
    ["AB with GST", billed("V012", "AB", ["goods"], ["GST5"]), []],
    ["AB charged 13% HST (like AP-00253)", billed("V012", "AB", ["services"], ["HST13"]), WRONG],
    ["QC with GST + QST", billed("V012", "QC", ["services"], ["GST5", "QST9975"]), []],
    ["QC, GST only (like AP-00098)", billed("V012", "QC", ["services"], ["GST5"]), WRONG],
    ["BC services, GST only", billed("V012", "BC", ["services"], ["GST5"]), []],
    ["BC goods, GST + PST", billed("V012", "BC", ["goods", "services"], ["GST5", "PST7_BC"]), []],
    ["BC PST on services", billed("V012", "BC", ["services"], ["GST5", "PST7_BC"]), WRONG],
    ["BC goods without PST", billed("V012", "BC", ["goods"], ["GST5"]), WRONG],
    ["BC line type unknown, PST charged: not guessed", billed("V012", "BC", [null], ["GST5", "PST7_BC"]), []],
    ["BC line type unknown, no PST: not guessed", billed("V012", "BC", [null], ["GST5"]), []],
    ["insurance vendor, no tax", billed(refs.vendorList.find((v) => v.category === "Insurance")!.vendorId, "ON", ["services"], []), []],
    ["insurance vendor charging HST", billed(refs.vendorList.find((v) => v.category === "Insurance")!.vendorId, "ON", ["services"], ["HST13"]), WRONG],
    ["US vendor, no tax", billed("V016", "ON", ["services"], []), []],
    ["US vendor charging GST", billed("V016", "AB", ["services"], ["GST5"]), WRONG],
    ["province unknown", billed("V012", null, ["services"], []), []],
  ])("%s", (_, i, want) => expect(summary(checkTaxWrongForProvince(i, refs))).toEqual(want));

  it("names both taxes and amounts in the sentence", () => {
    const [f] = checkTaxWrongForProvince(billed("V012", "AB", ["services"], ["HST13"]), refs);
    expect(f.message).toBe(
      "Tax: this invoice is billed to Alberta, where 5% GST applies, so GST is expected. The vendor charged HST (13%) $130.00 (GST missing; HST not expected).",
    );
  });

  it("over history fires on exactly the three planted invoices", () => {
    const hits = [...history.resolved].filter(([, r]) => checkTaxWrongForProvince(r, refs).length).map(([id]) => id);
    expect(hits).toEqual(["AP-00098", "AP-00253", "AP-00325"]);
  });
});

describe("TAX_AMOUNT", () => {
  const off = (i: ResolvedInvoice, by: number) => ({ ...i, taxes: i.taxes.map((t, k) => (k === 0 ? { ...t, amount: t.amount.plus(by) } : t)) });
  it.each<Row>([
    ["HST right", billed("V012", "ON", ["services"], ["HST13"]), []],
    ["HST off by $5", off(billed("V012", "ON", ["services"], ["HST13"]), 5), [{ code: "TAX_AMOUNT", effect: "hold" }]],
    ["HST off by $0.02", off(billed("V012", "ON", ["services"], ["HST13"]), 0.02), []],
    ["QST on the pre-tax amount", billed("V012", "QC", ["services", "goods"], ["GST5", "QST9975"]), []],
    ["BC PST on goods lines only", billed("V012", "BC", ["goods", "services"], ["GST5", "PST7_BC"]), []],
    [
      "BC PST charged on all lines",
      (() => {
        const i = billed("V012", "BC", ["goods", "services"], ["GST5", "PST7_BC"]);
        return { ...i, taxes: i.taxes.map((t) => (t.taxCode === "PST7_BC" ? { ...t, amount: D("140.00") } : t)) };
      })(),
      [{ code: "TAX_AMOUNT", effect: "hold" }],
    ],
    ["wrong code: left to TAX_WRONG_FOR_PROVINCE", off(billed("V012", "AB", ["services"], ["HST13"]), 5), []],
  ])("%s", (_, i, want) => expect(summary(checkTaxAmount(i, refs))).toEqual(want));

  it("never fires on history", () => {
    for (const r of history.resolved.values()) expect(checkTaxAmount(r, refs)).toEqual([]);
  });
});

describe("TAX_NOT_REGISTERED", () => {
  it.each<Row>([
    ["V054: no tax, no number anywhere", billed("V054", "ON", ["services"], [], { gstHstNumber: null }), [{ code: "TAX_NOT_REGISTERED", effect: "info" }]],
    ["V054 charging HST", billed("V054", "ON", ["services"], ["HST13"], { gstHstNumber: null }), []],
    ["no tax but a number on file", billed("V012", "ON", ["services"], [], { gstHstNumber: null }), []],
    ["no tax but a number printed", billed("V054", "ON", ["services"], [], { gstHstNumber: "123456789RT0001" }), []],
    ["US vendor", billed("V016", "ON", ["services"], [], { gstHstNumber: null }), []],
  ])("%s", (_, i, want) => expect(summary(checkTaxNotRegistered(i, refs))).toEqual(want));
});

describe("CURRENCY_UNEXPECTED", () => {
  const usContract = refs.contractByVendor.get("V016")!;
  it.each<Row>([
    ["US vendor billing USD under a USD contract", fresh("V016", { currencyResolved: "USD", contractId: usContract.contractId }), []],
    ["US vendor billing CAD under a USD contract", fresh("V016", { currencyResolved: "CAD", contractId: usContract.contractId }), [{ code: "CURRENCY_UNEXPECTED", effect: "info" }]],
    ["Canadian vendor, no contract, USD", fresh("V012", { currencyResolved: "USD", contractId: null }), [{ code: "CURRENCY_UNEXPECTED", effect: "info" }]],
    ["Canadian vendor, no contract, CAD", fresh("V012", { currencyResolved: "CAD", contractId: null }), []],
  ])("%s", (_, i, want) => expect(summary(checkCurrencyUnexpected(i, refs))).toEqual(want));

  it("never fires on history", () => {
    for (const r of history.resolved.values()) expect(checkCurrencyUnexpected(r, refs)).toEqual([]);
  });
});
