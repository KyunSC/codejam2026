import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import { checkDupContent, checkDupExact, checkDupNear, checkDupPaidByCard, vendorGroup } from "../checks/dupes";
import { digitsKey, numberKey } from "../keys";
import { type Refs, refsAsOf } from "../refs";
import { D, fresh, history, inv, refs, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Refs, Array<{ code: string; effect: string }>];
const HOLD = (code: string) => [{ code, effect: "hold" }];
const known = (id: string) => history.known.find((k) => k.invoiceId === id)!;
/** A new invoice from the same vendor as history invoice `id`, with a printed number and other overrides. */
const like = (id: string, printed: string, over: Partial<ResolvedInvoice> = {}) => {
  return inv(id, { invoiceNumber: printed, numberKey: numberKey(printed), digitsKey: digitsKey(printed), ...over, fileSha256: "new" });
};

describe("DUP_EXACT", () => {
  it.each<Row>([
    ["same number, new date (like harlowsternllp_001468)", like("AP-00389", known("AP-00389").invoiceNumber!, { invoiceDate: "2026-10-06" }), refs, HOLD("DUP_EXACT")],
    ["same number, punctuation dropped (INV-01561 / INV01561)", like("AP-00370", known("AP-00370").invoiceNumber!.replace(/-/g, "")), refs, HOLD("DUP_EXACT")],
    ["next number in the sequence", like("AP-00370", "INV-99999"), refs, []],
    ["leading zeros differ (0604 vs 000604): reformatted, not exact", like("AP-00073", "0604"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkDupExact(i, r))).toEqual(want));

  it("says how the original was paid", () => {
    const [f] = checkDupExact(like("AP-00389", known("AP-00389").invoiceNumber!), refs);
    expect(f.message).toMatch(/Possible duplicate of AP-00389.*The original is paid; (EFT|CARD|CHEQUE)/);
    expect(f.related?.invoiceIds).toEqual(["AP-00389"]);
  });

  it("counts lookalike vendor records as one vendor", () => {
    expect(vendorGroup("V002", refs).sort()).toEqual(["V002", "V053"]);
    const fromV002 = history.known.find((k) => k.vendorId === "V002")!;
    const asV053 = fresh("V053", { invoiceNumber: fromV002.invoiceNumber, numberKey: fromV002.numberKey, digitsKey: fromV002.digitsKey });
    expect(summary(checkDupExact(asV053, refs))).toEqual(HOLD("DUP_EXACT"));
  });
});

describe("DUP_NEAR", () => {
  const k330 = known("AP-00330");
  it.each<Row>([
    ["583 vs FA-000583, same total (like brightlinesafety-inv-032)", like("AP-00330", "583", { total: k330.total }), refs, HOLD("DUP_NEAR")],
    ["000604 vs 604", like("AP-00073", "604"), refs, HOLD("DUP_NEAR")],
    ["same digits, total $50 apart", like("AP-00330", "583", { total: k330.total!.plus(50) }), refs, []],
    ["same digits, total within $1", like("AP-00330", "583", { total: k330.total!.plus("0.99") }), refs, HOLD("DUP_NEAR")],
    ["exact same printed number is DUP_EXACT, not near", like("AP-00330", k330.invoiceNumber!), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkDupNear(i, r))).toEqual(want));
});

describe("DUP_CONTENT", () => {
  const k = known("AP-00330");
  const copyLines = (id: string) => inv(id).lines;
  it.each<Row>([
    ["new number, same total, same line amounts, same date", like("AP-00330", "ZZ-7777", { invoiceDate: k.invoiceDate, lines: copyLines("AP-00330") }), refs, HOLD("DUP_CONTENT")],
    ["same content but 10 days apart", like("AP-00330", "ZZ-7777", { invoiceDate: "2026-12-30", lines: copyLines("AP-00330") }), refs, []],
    ["same total, different line amounts", like("AP-00330", "ZZ-7777", { lines: [{ ...copyLines("AP-00330")[0], amount: D("1.00") }] }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkDupContent(i, r))).toEqual(want));
});

describe("BUILD_PLAN trap: a fixed-fee vendor's next monthly bill is not a duplicate", () => {
  const fixed = [...refs.contracts.values()].filter((c) => c.billingType === "fixed_monthly");
  it.each(fixed.map((c) => [c.vendorId]))("%s: same total, next number, 3 weeks later", (vendorId) => {
    const last = history.known.filter((k) => k.vendorId === vendorId).sort((a, b) => a.invoiceDate!.localeCompare(b.invoiceDate!)).at(-1)!;
    const next = inv(last.invoiceId, { invoiceNumber: "NEXT-90001", numberKey: "NEXT90001", digitsKey: "90001", invoiceDate: "2026-11-20" });
    expect([...checkDupExact(next, refs), ...checkDupNear(next, refs), ...checkDupContent(next, refs)]).toEqual([]);
  });
});

describe("DUP_PAID_BY_CARD", () => {
  const ap15 = inv("AP-00015");
  it.each<Row>([
    ["AP-00015 matched by CT-00017, 7 days later", ap15, { ...refs, invoices: [], invoicesByVendor: new Map() }, HOLD("DUP_PAID_BY_CARD")],
    ["same vendor, different amount", { ...ap15, total: ap15.total!.plus(1), totalCad: ap15.totalCad!.plus(1) }, { ...refs, invoices: [], invoicesByVendor: new Map() }, []],
    ["charge 60 days later is outside the window", { ...ap15, invoiceDate: "2025-11-01" }, { ...refs, invoices: [], invoicesByVendor: new Map() }, []],
    ["vendor with no card charges", fresh("V012"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkDupPaidByCard(i, r))).toEqual(want));
});

describe("duplicates over history (each invoice against the ones before it)", () => {
  const hits: Record<string, string[]> = {};
  for (const [k, r] of refsAsOf(refs, history.known)) {
    const i = history.resolved.get(k.invoiceId)!;
    for (const [name, check] of Object.entries({ checkDupExact, checkDupNear, checkDupContent, checkDupPaidByCard })) {
      for (const f of check(i, r)) (hits[name] ??= []).push(`${k.invoiceId}~${f.related?.invoiceIds?.[0] ?? f.related?.cardTxnIds?.[0]}`);
    }
  }
  it("DUP_EXACT: the 5 planted pairs", () =>
    expect(hits.checkDupExact).toEqual(["AP-00026~AP-00007", "AP-00034~AP-00023", "AP-00224~AP-00215", "AP-00237~AP-00219", "AP-00407~AP-00394"]));
  it("DUP_NEAR: the 2 planted pairs", () => expect(hits.checkDupNear).toEqual(["AP-00077~AP-00073", "AP-00155~AP-00136"]));
  it("DUP_CONTENT: none", () => expect(hits.checkDupContent).toBeUndefined());
  it("DUP_PAID_BY_CARD: the 6 planted card charges, one invoice each", () =>
    expect(hits.checkDupPaidByCard?.map((h) => h.split("~")[1]).sort()).toEqual(["CT-00017", "CT-00026", "CT-00318", "CT-00324", "CT-00383", "CT-00551"]));
});
