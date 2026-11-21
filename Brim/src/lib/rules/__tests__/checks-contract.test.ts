import { describe, expect, it } from "vitest";
import type { ResolvedInvoice, ResolvedLine } from "../../types";
import {
  checkContractExpired,
  checkContractFeeMismatch,
  checkContractFuelOverCap,
  checkContractMonthlyCap,
  checkContractPeriodRepeat,
  checkContractRateOverCap,
} from "../checks/contract";
import { refsAsOf } from "../refs";
import { D, fresh, history, refs, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Array<{ code: string; effect: string }>];
const line = (lineNo: number, description: string, qty: string, price: string): ResolvedLine => ({
  lineNo,
  description,
  quantity: D(qty),
  unitPrice: D(price),
  amount: D(qty).mul(price).toDecimalPlaces(2),
  glAccount: null,
  lineType: "services",
  lineTypeSource: null,
});
const withLines = (vendorId: string, lines: ResolvedLine[], over: Partial<ResolvedInvoice> = {}) => {
  const subtotal = lines.reduce((s, l) => s.plus(l.amount!), D(0));
  return fresh(vendorId, { lines, subtotal, taxes: [], total: subtotal, ...over });
};
const c = (vendorId: string) => refs.contractByVendor.get(vendorId)!;

describe("CONTRACT_EXPIRED", () => {
  it.each<Row>([
    ["V044 after C025 ended 2026-06-30", fresh("V044", { invoiceDate: "2026-10-20" }), [{ code: "CONTRACT_EXPIRED", effect: "hold" }]],
    ["V044 on the last day", fresh("V044", { invoiceDate: "2026-06-30" }), []],
    ["active contract", fresh("V015", { invoiceDate: "2026-10-20" }), []],
    ["no contract", fresh("V012", { contractId: null }), []],
  ])("%s", (_, i, want) => expect(summary(checkContractExpired(i, refs))).toEqual(want));
});

describe("CONTRACT_FEE_MISMATCH", () => {
  const fee = (v: string) => c(v).monthlyFee!;
  it.each<Row>([
    ["V022: $2,343.50 vs $2,150.00", withLines("V022", [line(1, "Business mobile plans", "1", "2343.50")]), [{ code: "CONTRACT_FEE_MISMATCH", effect: "route" }]],
    ["V019: $8,200.00 vs $1,320.00", withLines("V019", [line(1, "Services", "1", "8200.00")]), [{ code: "CONTRACT_FEE_MISMATCH", effect: "route" }]],
    ["V022 at the fee", withLines("V022", [line(1, "Business mobile plans", "1", fee("V022").toString())]), []],
    ["blanket contract is not fixed-fee", withLines("V008", [line(1, "Fuel card", "1", "12345.00")]), []],
  ])("%s", (_, i, want) => expect(summary(checkContractFeeMismatch(i, refs))).toEqual(want));

  it("counts earlier invoices that were off the fee", () => {
    const [f] = checkContractFeeMismatch(withLines("V022", [line(1, "Plans", "1", "2343.50")]), refs);
    expect(f.message).toMatch(/\$2,343.50 but contract C\d+ fixes the monthly fee at \$2,150.00 \(over by \$193.50\)/);
    expect(f.message).toMatch(/\d+ earlier invoices? (was|were) also off the fee/);
  });
});

describe("CONTRACT_RATE_OVER_CAP", () => {
  it.each<Row>([
    ["V029 at $170, $215, $240 against a $245 cap", withLines("V029", [line(1, "Strategy workshop", "8", "170"), line(2, "Analysis", "10", "215"), line(3, "Partner time", "4", "240")]), []],
    ["V029 at $260 for 6 hours", withLines("V029", [line(1, "Senior consultant", "6", "260")]), [{ code: "CONTRACT_RATE_OVER_CAP", effect: "hold" }]],
    ["quantity 1 but billed by the hour", withLines("V029", [line(1, "Consulting hours", "1", "300")]), [{ code: "CONTRACT_RATE_OVER_CAP", effect: "hold" }]],
    ["quantity 1 flat fee", withLines("V029", [line(1, "Project fee", "1", "3000")]), []],
    ["no hourly cap", withLines("V012", [line(1, "Labour", "10", "999")]), []],
  ])("%s", (_, i, want) => expect(summary(checkContractRateOverCap(i, refs))).toEqual(want));
});

describe("CONTRACT_FUEL_OVER_CAP", () => {
  const shipments = [line(1, "LTL shipment Toronto-Montreal", "1", "1000.00"), line(2, "LTL shipment Hamilton-Ottawa", "1", "500.00")];
  it.each<Row>([
    ["V001 at 22% against 12%", withLines("V001", [...shipments, line(3, "Fuel surcharge (22%)", "1", "330.00")]), [{ code: "CONTRACT_FUEL_OVER_CAP", effect: "hold" }]],
    ["V001 at 12%", withLines("V001", [...shipments, line(3, "Fuel surcharge (12%)", "1", "180.00")]), []],
    ["V004 at 7.07% against 10%", withLines("V004", [...shipments, line(3, "Fuel surcharge (7.07%)", "1", "106.05")]), []],
    [
      "detention is not part of the base",
      withLines("V001", [...shipments, line(3, "Detention / waiting time", "2", "500"), line(4, "Fuel surcharge (12%)", "1", "180.00")]),
      [],
    ],
    ["no surcharge line", withLines("V001", shipments), []],
  ])("%s", (_, i, want) => expect(summary(checkContractFuelOverCap(i, refs))).toEqual(want));

  it("states the percentage and the cap", () => {
    const [f] = checkContractFuelOverCap(withLines("V001", [...shipments, line(3, "Fuel surcharge (22%)", "1", "330.00")]), refs);
    expect(f.message).toMatch(/is 22% of the \$1,500.00 in shipment lines; contract C018 caps it at 12%/);
  });
});

describe("CONTRACT_MONTHLY_CAP", () => {
  const octV008 = history.known.filter((k) => k.vendorId === "V008" && k.invoiceDate?.startsWith("2026-10"));
  const octSum = octV008.reduce((s, k) => s.plus(k.subtotal!), D(0));
  const cap = c("V008").notToExceedMonthly!;
  it.each<Row>([
    ["V008 October goes over $9,000 with this invoice", withLines("V008", [line(1, "Fleet fuel card charges", "1", cap.minus(octSum).plus(1).toString())], { invoiceDate: "2026-10-30" }), [{ code: "CONTRACT_MONTHLY_CAP", effect: "route" }]],
    ["V008 October stays at the limit", withLines("V008", [line(1, "Fleet fuel card charges", "1", cap.minus(octSum).toString())], { invoiceDate: "2026-10-30" }), []],
    ["V008 November, a fresh month", withLines("V008", [line(1, "Fleet fuel card charges", "1", "500.00")], { invoiceDate: "2026-11-01" }), []],
    ["no monthly limit", withLines("V015", [line(1, "Subscription", "1", "99999.00")]), []],
  ])("%s", (_, i, want) => expect(summary(checkContractMonthlyCap(i, refs))).toEqual(want));

  it("October already has AP-00424 on file", () => expect(octV008.map((k) => k.invoiceId)).toContain("AP-00424"));
});

describe("CONTRACT_PERIOD_REPEAT", () => {
  const last = history.known.filter((k) => k.vendorId === "V015").sort((a, b) => a.invoiceDate!.localeCompare(b.invoiceDate!)).at(-1)!;
  it.each<Row>([
    ["second bill in the same month (info only)", fresh("V015", { invoiceDate: last.invoiceDate!.slice(0, 7) + "-28" }), [{ code: "CONTRACT_PERIOD_REPEAT", effect: "info" }]],
    ["first bill of the next month", fresh("V015", { invoiceDate: "2026-12-01" }), []],
    ["not a fixed-fee vendor", fresh("V008", { invoiceDate: "2026-10-30" }), []],
  ])("%s", (_, i, want) => expect(summary(checkContractPeriodRepeat(i, refs))).toEqual(want));
});

describe("contract checks over history (each invoice against the ones before it)", () => {
  const hits: Record<string, string[]> = {};
  const checks = { checkContractExpired, checkContractFeeMismatch, checkContractRateOverCap, checkContractFuelOverCap, checkContractMonthlyCap, checkContractPeriodRepeat };
  for (const [k, r] of refsAsOf(refs, history.known)) {
    for (const [name, check] of Object.entries(checks)) if (check(history.resolved.get(k.invoiceId)!, r).length) (hits[name] ??= []).push(k.invoiceId);
  }

  it("fee mismatch on the 13 planted invoices", () => expect(hits.checkContractFeeMismatch).toHaveLength(13));
  it("monthly cap on the three planted months", () => expect(hits.checkContractMonthlyCap).toEqual(["AP-00075", "AP-00155", "AP-00234"]));
  it("no rate, fuel or expiry breach (none planted)", () => {
    expect(hits.checkContractExpired).toBeUndefined();
    expect(hits.checkContractRateOverCap).toBeUndefined();
    expect(hits.checkContractFuelOverCap).toBeUndefined();
  });
  it("one period repeat: the duplicate AP-00026", () => expect(hits.checkContractPeriodRepeat).toEqual(["AP-00026"]));
});
