import { describe, expect, it } from "vitest";
import { config } from "../../config";
import { loadApprovalPolicies, type ApprovalPolicyRow } from "../../dataset";
import { policyRulesFrom } from "../seed-rules";

describe("policy rules from approval_policies.csv", () => {
  const rules = policyRulesFrom(loadApprovalPolicies());
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]));

  it("maps all 13 rows, keeping type and source text", () => {
    expect(rules.map((r) => r.id)).toEqual(
      ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "P13"],
    );
    expect(byId.P09.type).toBe("payment_release");
    expect(byId.P12.type).toBe("match");
    expect(byId.P02.sourceText).toBe("Invoice total over $10,000 CAD → dept_manager > finance_manager");
    expect(rules.every((r) => r.active)).toBe(true);
  });

  it("locks exactly the three invariants the brief imposes on every role", () => {
    expect(rules.filter((r) => r.locked).map((r) => r.id)).toEqual(["P07", "P08", "P11"]);
    for (const id of ["P07", "P08", "P11"]) {
      expect(byId[id].effect.kind).toBe("invariant");
      expect(byId[id].when).toEqual([]);
    }
  });

  it("takes amount bands from config, not literals", () => {
    expect(byId.P01.when).toEqual([{ field: "totalCad", op: "lte", value: config.approval.deptManagerMaxCad }]);
    expect(byId.P03.when).toEqual([{ field: "totalCad", op: "gt", value: config.approval.controllerAboveCad }]);
    expect(byId.P04.effect).toEqual({
      kind: "requireSteps",
      steps: ["dept_manager", "finance_manager", "controller_admin", "cfo"],
    });
    expect(byId.P09.effect).toEqual({
      kind: "releaseBy",
      roles: ["finance_manager", "controller_admin"],
      maxCad: config.release.financeManagerMaxCad,
    });
    expect(byId.P10.effect).toEqual({ kind: "releaseBy", roles: ["controller_admin"], maxCad: null });
  });

  it("reads P05 as pending_review OR new, and P13 as requires-PO AND none present", () => {
    expect(byId.P05.when).toEqual([
      {
        any: [
          { field: "vendor.status", op: "in", value: ["pending_review"] },
          { field: "vendor.isNew", op: "eq", value: true },
        ],
      },
    ]);
    expect(byId.P13.effect).toEqual({ kind: "hold", flag: "PO_REQUIRED_MISSING" });
    expect(byId.P13.when).toContainEqual({ field: "poPresent", op: "eq", value: false });
  });

  it("refuses a CSV row it has no mapping for", () => {
    const extra: ApprovalPolicyRow = {
      ruleId: "P14",
      ruleType: "approval",
      condition: "x",
      required: "y",
      notes: null,
    };
    expect(() => policyRulesFrom([...loadApprovalPolicies(), extra])).toThrow(/No mapping for: \[P14\]/);
  });

  it("refuses a CSV that lost a row", () => {
    expect(() => policyRulesFrom(loadApprovalPolicies().slice(1))).toThrow(/no CSV row for: \[P01\]/);
  });
});
