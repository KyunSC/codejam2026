import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import type { Refs } from "../refs";
import {
  checkTaxNumberMismatch,
  checkVendorLookalike,
  checkVendorNew,
  checkVendorOnHold,
  checkVendorPending,
  checkVendorUnknown,
  lookalikePairs,
} from "../checks/vendor";
import { fresh, history, refs, refsWith, summary } from "./fixtures";

type Want = Array<{ code: string; effect: string }>;
type Row = [string, ResolvedInvoice, Refs, Want];

describe("VENDOR_UNKNOWN", () => {
  it.each<Row>([
    ["resolved vendor", fresh("V012"), refs, []],
    ["no vendor resolved", fresh("V012", { vendorId: null, vendorName: "Blue Heron Couriers", vendorCandidates: [] }), refs, [{ code: "VENDOR_UNKNOWN", effect: "hold" }]],
    ["no vendor, candidates offered", fresh("V012", { vendorId: null, vendorName: "Harlow & Stern", vendorCandidates: ["V026", "V052"] }), refs, [{ code: "VENDOR_UNKNOWN", effect: "hold" }]],
  ])("%s", (_, i, r, want) => expect(summary(checkVendorUnknown(i, r))).toEqual(want));

  it("names the candidates in the sentence", () => {
    const [f] = checkVendorUnknown(fresh("V012", { vendorId: null, vendorName: "Harlow & Stern", vendorCandidates: ["V026", "V052"] }), refs);
    expect(f.message).toMatch(/V026 Harlow & Stern LLP; V052 Harlow and Stern LLP/);
    expect(f.related?.vendorIds).toEqual(["V026", "V052"]);
  });
});

describe("VENDOR_PENDING", () => {
  it.each<Row>([
    ["V054 pending_review", fresh("V054"), refs, [{ code: "VENDOR_PENDING", effect: "hold" }]],
    ["active vendor", fresh("V012"), refs, []],
    ["on-hold vendor is not pending", fresh("V053"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkVendorPending(i, r))).toEqual(want));
});

describe("VENDOR_ON_HOLD", () => {
  it.each<Row>([
    ["V053 on hold", fresh("V053"), refs, [{ code: "VENDOR_ON_HOLD", effect: "hold" }]],
    ["active vendor", fresh("V002"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkVendorOnHold(i, r))).toEqual(want));

  it("is a fraud flag", () => expect(checkVendorOnHold(fresh("V053"), refs)[0].klass).toBe("fraud"));
});

describe("VENDOR_NEW", () => {
  const v012 = history.known.filter((k) => k.vendorId === "V012");
  it.each<Row>([
    ["V052, no history", fresh("V052"), refs, [{ code: "VENDOR_NEW", effect: "route" }]],
    ["V054, V055, V056 have no history", fresh("V055"), refs, [{ code: "VENDOR_NEW", effect: "route" }]],
    ["vendor with paid invoices", fresh("V012"), refs, []],
    ["only a rejected invoice so far", fresh("V012"), refsWith(v012.slice(0, 1).map((k) => ({ ...k, status: "rejected" }))), [{ code: "VENDOR_NEW", effect: "route" }]],
    ["unknown vendor", fresh("V012", { vendorId: null }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkVendorNew(i, r))).toEqual(want));
});

describe("VENDOR_LOOKALIKE", () => {
  it("finds exactly the three planted pairs", () => {
    expect(lookalikePairs(refs.vendorList).map(([a, b]) => `${a.vendorId}/${b.vendorId}`)).toEqual(["V001/V051", "V002/V053", "V026/V052"]);
  });

  it.each<Row>([
    ["V052 (no history) imitates V026", fresh("V052"), refs, [{ code: "VENDOR_LOOKALIKE", effect: "hold" }]],
    ["V051 (3 invoices) imitates V001 (12)", fresh("V051"), refs, [{ code: "VENDOR_LOOKALIKE", effect: "hold" }]],
    ["V053 (2 invoices) imitates V002 (12)", fresh("V053"), refs, [{ code: "VENDOR_LOOKALIKE", effect: "hold" }]],
    ["V026, the established record", fresh("V026"), refs, []],
    ["V001, the established record", fresh("V001"), refs, []],
    ["vendor with no lookalike", fresh("V012"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkVendorLookalike(i, r))).toEqual(want));

  it("says which fields differ", () => {
    expect(checkVendorLookalike(fresh("V052"), refs)[0].message).toMatch(/different tax number and bank account/);
    expect(checkVendorLookalike(fresh("V051"), refs)[0].message).toMatch(/different tax number\./);
  });
});

describe("TAX_NUMBER_MISMATCH", () => {
  const v = refs.vendors.get("V004")!;
  it.each<Row>([
    ["found by name, different tax number printed", fresh("V004", { vendorMatchedBy: "name", gstHstNumber: "111111111RT0001" }), refs, [{ code: "TAX_NUMBER_MISMATCH", effect: "hold" }]],
    ["found by name, same number with spaces", fresh("V004", { vendorMatchedBy: "name", gstHstNumber: v.gstHstNumber!.replace("RT", " RT ") }), refs, []],
    ["found by tax number", fresh("V004", { vendorMatchedBy: "tax_number" }), refs, []],
    ["no tax number printed", fresh("V004", { vendorMatchedBy: "name", gstHstNumber: null }), refs, []],
    ["vendor has no tax number on file", fresh("V054", { vendorMatchedBy: "name", gstHstNumber: "111111111RT0001" }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkTaxNumberMismatch(i, r))).toEqual(want));
});
