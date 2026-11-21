import { describe, expect, it } from "vitest";
import { loadVendors } from "../../dataset";
import { normalizeName } from "../keys";
import { resolveVendor } from "../resolve/vendor";

const refs = { vendorList: loadVendors() };
const noRemit = { institution: null, transit: null, account: null, text: null };
const doc = (
  vendorName: string | null,
  gstHstNumber: string | null = null,
  remit: { institution: string | null; transit: string | null; account: string | null; text: string | null } = noRemit,
) => ({ vendorName, gstHstNumber, remit });

describe("resolveVendor", () => {
  it.each([
    // [case, document, expected vendor, matched by]
    ["tax number wins over a name shared by two records", doc("Polar Freight Lines Ltd.", "995133220RT0001"), "V001", "tax_number"],
    ["tax number picks the lookalike when it is the one printed", doc("Harlow and Stern LLP", "503486760 RT0001"), "V052", "tax_number"],
    ["tax number resolves the active record, not the on-hold lookalike", doc("Great Lakes Carriers Inc.", "367912731RT0001"), "V002", "tax_number"],
    ["bank account plus a similar name", doc("Cascadia Cartage", null, { institution: "003", transit: "92968", account: "953389679", text: null }), "V004", "bank_account"],
    ["unique normalised name", doc("QUEEN STREET PROPERTIES INC"), "V036", "name"],
    ["unknown tax number falls through to the name", doc("Cascadia Cartage Ltd", "000000000RT0001"), "V004", "name"],
  ])("%s", (_, d, vendorId, how) => {
    const r = resolveVendor(d, refs);
    expect(r.vendorId).toBe(vendorId);
    expect(r.vendorMatchedBy).toBe(how);
    expect(r.vendorCandidates).toEqual([]);
  });

  it.each([
    ["shared bank and shared name", doc("Polar Freight Lines", null, { institution: "004", transit: "95688", account: "410652201", text: null }), ["V001", "V051"]],
    ["name shared by two records", doc("Great Lakes Carriers"), ["V002", "V053"]],
    ["name shared by a lookalike pair", doc("Harlow & Stern"), ["V026", "V052"]],
  ])("ambiguous: %s → no vendor, both offered", (_, d, both) => {
    const r = resolveVendor(d, refs);
    expect(r.vendorId).toBeNull();
    expect(r.vendorCandidates.slice(0, 2).sort()).toEqual(both);
    expect(r.reason).toMatch(/more than one vendor record/);
  });

  it.each([
    ["Blue Heron Couriers"],
    ["Zephyr Data Services Inc."],
    [null],
  ])("unknown: %s → no vendor", (name) => {
    const r = resolveVendor(doc(name), refs);
    expect(r.vendorId).toBeNull();
    expect(r.vendorMatchedBy).toBeNull();
    expect(r.reason).toMatch(/No vendor record matches/);
  });

  it("offers close names for an unknown vendor but never picks one", () => {
    const r = resolveVendor(doc("Cascadia Cartage Services"), refs);
    expect(r.vendorId).toBeNull();
    expect(r.vendorCandidates[0]).toBe("V004");
  });

  it("does not take a bank match when the names differ", () => {
    const r = resolveVendor(doc("Totally Different Name", null, { institution: "003", transit: "92968", account: "953389679", text: null }), refs);
    expect(r.vendorId).toBeNull();
  });

  it("resolves every master record by its own tax number, and by name when the name is unique", () => {
    const vendors = loadVendors();
    for (const v of vendors) {
      const r = resolveVendor(doc(v.legalName, v.gstHstNumber), refs);
      const nameIsUnique = vendors.filter((o) => normalizeName(o.legalName) === normalizeName(v.legalName)).length === 1;
      if (v.gstHstNumber || nameIsUnique) expect(r.vendorId, v.vendorId).toBe(v.vendorId);
      else expect(r.vendorId, v.vendorId).toBeNull();
    }
  });
});
