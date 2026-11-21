import { describe, expect, it } from "vitest";
import { codingAccuracy } from "../../../../scripts/coding-accuracy";
import { buildCodingModel, descriptionKey, suggestAccount } from "../coding";
import { ds, history, refs } from "./fixtures";

const model = buildCodingModel(history.known);
const vendor = (id: string) => refs.vendors.get(id)!;

describe("suggestAccount", () => {
  it.each([
    ["racking at a packaging vendor whose default is 5040", "Racking components", "V010", "5030", "vendor_description"],
    ["another line at the same vendor", "Stretch wrap cases", "V010", vendor("V010").defaultGlAccount, "vendor_default"],
    ["a description the vendor never billed", "Something brand new", "V012", vendor("V012").defaultGlAccount, "vendor_default"],
    ["unknown vendor, freight wording", "LTL shipment Halifax-Moncton", null, "5010", "nearest_description"],
    ["unknown vendor, nothing in common", "Zzzqx", null, null, "none"],
  ])("%s", (_, description, vendorId, account, source) => {
    const s = suggestAccount(description, vendorId ? vendor(vendorId) : undefined, model, refs);
    expect(s.glAccount).toBe(account);
    expect(s.source).toBe(source);
    expect(s.reason.length).toBeGreaterThan(20);
  });

  it("writes the reason like BUILD_PLAN's example", () => {
    const paperTrail = refs.vendorList.find((v) => v.legalName.startsWith("Paper Trail"))!;
    const s = suggestAccount("Printer paper cartons", paperTrail, model, refs);
    expect(s.reason).toMatch(new RegExp(`^${paperTrail.legalName}: \\d+ of \\d+ past lines coded ${paperTrail.defaultGlAccount} .+ \\(vendor default\\)\\.$`));
  });

  it("ignores numbers when comparing descriptions", () => {
    expect(descriptionKey("Pallets (48x40), qty 120")).toBe(descriptionKey("Pallets (48x40), qty 80"));
  });
});

describe("over history", () => {
  it("the vendor default alone is right on 799 of 809 lines (BUILD_PLAN)", () => {
    const vendors = new Map(ds.vendors.map((v) => [v.vendorId, v]));
    const inv = new Map(ds.invoices.map((i) => [i.invoiceId, i]));
    const right = ds.invoiceLines.filter((l) => vendors.get(inv.get(l.invoiceId)!.vendorId)!.defaultGlAccount === l.glAccount).length;
    expect(right).toBe(799);
  });

  it("the 10 racking lines are all 5030, at vendors whose default is 5040", () => {
    const rack = ds.invoiceLines.filter((l) => l.description === "Racking components");
    expect(rack).toHaveLength(10);
    expect(new Set(rack.map((l) => l.glAccount))).toEqual(new Set(["5030"]));
  });
});

describe("accuracy, trained Jan–Aug, tested Sep–Oct", () => {
  const a = codingAccuracy(ds);
  it("splits history 348 / 78", () => expect([a.trainInvoices, a.testInvoices]).toEqual([348, 78]));
  it("account right on first suggestion: 147 of 147 lines", () => expect(a.account).toMatchObject({ right: 147, of: 147 }));
  it("department right on first suggestion: 143 of 147 lines, 76 of 78 invoices", () => {
    expect(a.departmentLines).toEqual({ right: 143, of: 147 });
    expect(a.departmentInvoices).toEqual({ right: 76, of: 78 });
  });
});
