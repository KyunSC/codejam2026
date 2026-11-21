import { describe, expect, it } from "vitest";
import { policyRulesFromCsv, releaseRoles } from "../routing/policy";
import { releaseEligibility, type RoutingInput, route, routingInputFor } from "../routing/route";
import { D, ds, fresh, history, refs } from "./fixtures";

const rules = policyRulesFromCsv(ds.approvalPolicies);
const vendor = (id: string) => refs.vendors.get(id)!;
const input = (over: Partial<RoutingInput>): RoutingInput => ({
  totalCad: 1000,
  departmentId: "D01",
  requesterId: null,
  vendor: vendor("V012"),
  flags: [],
  overridden: [],
  ...over,
});
const chain = (r: ReturnType<typeof route>) => r.steps.map((s) => (s.onBehalfOfId ? `${s.assignedToId} for ${s.onBehalfOfId}` : s.assignedToId));
const releasers = (amount: number, r: ReturnType<typeof route>) => releaseEligibility(amount, r.steps, rules, refs);

describe("policy rows", () => {
  it("maps all 13 CSV rules, keeping their text, with P07, P08, P11 locked", () => {
    expect(rules.map((r) => r.id)).toEqual(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "P13"]);
    expect(rules.filter((r) => r.locked).map((r) => r.id)).toEqual(["P07", "P08", "P11"]);
    expect(rules.find((r) => r.id === "P02")!.sourceText).toContain("Invoice total over $10,000 CAD");
  });

  it.each([
    [100_000, ["finance_manager", "controller_admin"]],
    [100_000.01, ["controller_admin"]],
  ])("release bands at $%d", (amount, want) => expect([...releaseRoles(amount, rules).roles].sort()).toEqual([...want].sort()));
});

describe("BUILD_PLAN's five worked examples", () => {
  it("1. D01 invoice, $4,743.80 → U007; release U003, U002 or U001", () => {
    const r = route(input({ totalCad: 4743.8, departmentId: "D01" }), rules, refs);
    expect(chain(r)).toEqual(["U007"]);
    expect(r.blocked).toEqual([]);
    expect(releasers(4743.8, r).releaserIds).toEqual(["U003", "U002", "U001"]);
  });

  it("2. D07 rent invoice, $18,758.00 (V036) → U003 for U012 on leave; FM step moves from U003 to U002; release U001 only", () => {
    const r = route(input({ totalCad: 18_758, departmentId: "D07", vendor: vendor("V036") }), rules, refs);
    expect(chain(r)).toEqual(["U003 for U012", "U002"]);
    expect(r.steps[0]).toMatchObject({ role: "dept_manager", limitCad: 10_000, ruleIds: ["P02"] });
    expect(r.steps[0].replacements[0]).toMatch(/U012 .* on leave → delegate U003/);
    expect(r.steps[1]).toMatchObject({ role: "finance_manager", ruleIds: ["P02"] });
    expect(r.steps[1].replacements[0]).toMatch(/U003 .* already holds step 1 .* → manager U002/);
    expect(releasers(18_758, r).releaserIds).toEqual(["U001"]);
  });

  it("3. Legal invoice from an established vendor, $339.52, D08 → U001; U003 (P06); release U002 only", () => {
    const r = route(input({ totalCad: 339.52, departmentId: "D08", vendor: vendor("V026") }), rules, refs);
    expect(chain(r)).toEqual(["U001", "U003"]);
    expect(r.steps[1].ruleIds).toEqual(["P06"]);
    expect(releasers(339.52, r).releaserIds).toEqual(["U002"]);
  });

  it("4. Invoice requested by U010, IT, $2,700 → dept manager is U010 → U001 (P07); release U003 or U002", () => {
    const r = route(input({ totalCad: 2700, departmentId: "D05", requesterId: "U010" }), rules, refs);
    expect(chain(r)).toEqual(["U001"]);
    expect(r.steps[0].replacements[0]).toMatch(/U010 .* requested this invoice \(P07\) → manager U001/);
    expect(releasers(2700, r).releaserIds).toEqual(["U003", "U002"]);
  });

  it("5. D04 invoice, $60,000 → U002; U003; controller step is U002 again → U001; nobody may release", () => {
    const r = route(input({ totalCad: 60_000, departmentId: "D04" }), rules, refs);
    expect(chain(r)).toEqual(["U002", "U003", "U001"]);
    expect(r.steps[2].replacements[0]).toMatch(/U002 .* already holds step 1 .* → manager U001/);
    const rel = releasers(60_000, r);
    expect(rel.releaserIds).toEqual([]);
    expect(rel.blockedReason).toMatch(/Nobody may release \$60,000.00: everyone allowed to \(U003, U002, U001\) approved this invoice/);
  });
});

describe("routing rules", () => {
  it.each([
    ["new vendor (P05) adds the finance manager", input({ flags: ["VENDOR_NEW"] }), ["U007", "U003"]],
    ["pending vendor (P05) adds the finance manager", input({ flags: ["VENDOR_PENDING"] }), ["U007", "U003"]],
    ["PO over balance (P12) adds the finance manager", input({ flags: ["PO_OVER_BALANCE"] }), ["U007", "U003"]],
    ["an overridden flag adds the finance manager", input({ overridden: ["VENDOR_ON_HOLD"] }), ["U007", "U003"]],
    ["over $250,000 needs all four", input({ totalCad: 300_000 }), ["U007", "U003", "U002", "U001"]],
    // U015 (D01) is terminated; their manager U007 stands in as requester, and U007 is D01's manager → U001.
    ["a terminated requester is replaced by their manager, who then cannot approve", input({ departmentId: "D01", requesterId: "U015" }), ["U001"]],
  ])("%s", (_, i, want) => expect(chain(route(i, rules, refs))).toEqual(want));

  it("P13 holds a PO-required vendor with no PO", () => {
    expect(route(input({ flags: ["PO_REQUIRED_MISSING"] }), rules, refs).holds).toEqual([{ ruleId: "P13", flag: "PO_REQUIRED_MISSING" }]);
    expect(route(input({}), rules, refs).holds).toEqual([]);
  });

  it("an invoice with no department has an unresolvable step and is blocked", () => {
    const r = route(input({ departmentId: null }), rules, refs);
    expect(r.steps[0]).toMatchObject({ assignedToId: null, unresolvable: expect.stringMatching(/no department/) });
    expect(r.blocked).toHaveLength(1);
  });

  it("a replacement with nobody to go to is unresolvable (CFO requesting her own invoice)", () => {
    const r = route(input({ departmentId: "D08", requesterId: "U001" }), rules, refs);
    expect(r.steps[0]).toMatchObject({ assignedToId: null });
    expect(r.blocked[0]).toMatch(/requested this invoice .* no manager/);
  });

  it("over $100,000 only controllers may release; over $250,000 nobody may", () => {
    const r1 = route(input({ totalCad: 120_000, departmentId: "D01" }), rules, refs);
    expect(chain(r1)).toEqual(["U007", "U003", "U002"]);
    expect(releasers(120_000, r1).releaserIds).toEqual(["U001"]);
    const r2 = route(input({ totalCad: 300_000, departmentId: "D01" }), rules, refs);
    expect(releasers(300_000, r2).releaserIds).toEqual([]);
  });

  it("a draft rule set changes the route (policy editor preview)", () => {
    const draft = rules.map((r) => (r.id === "P06" ? { ...r, active: false } : r));
    expect(chain(route(input({ totalCad: 339.52, departmentId: "D08", vendor: vendor("V026") }), draft, refs))).toEqual(["U001"]);
  });
});

describe("routing input", () => {
  it("routes a suspected split as the combined amount", () => {
    const piece = (id: string, n: string) => ({ ...history.known[0], invoiceId: id, vendorId: "V029", numberKey: n, digitsKey: n, invoiceDate: "2026-10-28", totalCad: D("4847.70"), status: "pending_approval", requesterId: null, kind: "invoice" as const });
    const batch = [piece("B1", "281"), piece("B2", "287")];
    const r = { ...refs, invoices: batch, invoicesByVendor: new Map([["V029", batch]]) };
    const i = fresh("V029", { invoiceNumber: "29", numberKey: "29", digitsKey: "29", invoiceDate: "2026-10-28", requesterId: null });
    const ri = routingInputFor({ ...i, totalCad: D("4847.70") }, [], r);
    expect(ri.totalCad).toBeCloseTo(14543.1, 2);
    expect(chain(route({ ...ri, departmentId: "D06" }, rules, r))).toEqual(["U011", "U003"]);
  });
});

describe("history agrees with the policy", () => {
  it("P01–P13 alone give a finance manager step on 46 history invoices: the 43 over $10,000 and the 3 legal ones", () => {
    const fm = ds.invoices.filter((inv) => {
      const v = refs.vendors.get(inv.vendorId)!;
      return route(input({ totalCad: inv.totalCad.toNumber(), departmentId: inv.departmentId, vendor: v }), rules, refs).steps.some((s) => s.role === "finance_manager");
    });
    const over = fm.filter((i) => i.totalCad.gt(10_000)).length;
    expect([fm.length, over]).toEqual([46, 43]);
  });

  it("history's 48 finance manager steps are those 46 plus the 2 on-hold-vendor invoices (an overridden fraud flag adds the step)", () => {
    const withFm = new Set(ds.approvals.filter((a) => a.approverRole === "finance_manager").map((a) => a.invoiceId));
    expect(withFm.size).toBe(48);
    const predicted = new Set(
      ds.invoices
        .filter((inv) => {
          const v = refs.vendors.get(inv.vendorId)!;
          const overridden = v.status === "on_hold" ? (["VENDOR_ON_HOLD"] as const) : [];
          return route(input({ totalCad: inv.totalCad.toNumber(), departmentId: inv.departmentId, vendor: v, overridden: [...overridden] }), rules, refs).steps.some((s) => s.role === "finance_manager");
        })
        .map((i) => i.invoiceId),
    );
    expect([...predicted].sort()).toEqual([...withFm].sort());
  });
});
