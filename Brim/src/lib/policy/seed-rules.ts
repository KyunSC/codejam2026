/**
 * The 13 rows of approval_policies.csv, mapped by hand to structured rules
 * (BUILD_PLAN "Policy rows"). The seed writes these to the PolicyRule table; after that the
 * table wins, so a controller's edit takes effect without a deploy.
 *
 * Amounts come from config.ts, never literals. `sourceText` keeps the CSV's wording so the
 * policy editor can show what each structured row was read from.
 */
import { config } from "../config";
import type { ApprovalPolicyRow } from "../dataset";
import type { Condition, Effect, PolicyRule } from "../types";

type Mapping = { when: Condition[]; effect: Effect; locked?: boolean };

const { deptManagerMaxCad, controllerAboveCad, cfoAboveCad } = config.approval;
const { financeManagerMaxCad } = config.release;

/** Hand mapping, keyed by rule_id. Every CSV row must have one (checked in policyRulesFrom). */
export const POLICY_MAPPING: Readonly<Record<string, Mapping>> = {
  P01: {
    when: [{ field: "totalCad", op: "lte", value: deptManagerMaxCad }],
    effect: { kind: "requireSteps", steps: ["dept_manager"] },
  },
  P02: {
    when: [{ field: "totalCad", op: "gt", value: deptManagerMaxCad }],
    effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager"] },
  },
  P03: {
    when: [{ field: "totalCad", op: "gt", value: controllerAboveCad }],
    effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager", "controller_admin"] },
  },
  P04: {
    when: [{ field: "totalCad", op: "gt", value: cfoAboveCad }],
    effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager", "controller_admin", "cfo"] },
  },
  P05: {
    when: [
      {
        any: [
          { field: "vendor.status", op: "in", value: ["pending_review"] },
          { field: "vendor.isNew", op: "eq", value: true },
        ],
      },
    ],
    effect: { kind: "requireSteps", steps: ["finance_manager"] },
  },
  P06: {
    when: [{ field: "vendor.category", op: "in", value: ["Legal"] }],
    effect: { kind: "requireSteps", steps: ["finance_manager"] },
  },
  P07: { when: [], effect: { kind: "invariant", name: "noSelfApproval" }, locked: true },
  P08: { when: [], effect: { kind: "invariant", name: "delegateWhenOnLeave" }, locked: true },
  // Payment amount in CAD equals the invoice's totalCad (one payment per invoice, BUILD_PLAN Non-goals).
  P09: {
    when: [{ field: "totalCad", op: "lte", value: financeManagerMaxCad }],
    effect: { kind: "releaseBy", roles: ["finance_manager", "controller_admin"], maxCad: financeManagerMaxCad },
  },
  P10: {
    when: [{ field: "totalCad", op: "gt", value: financeManagerMaxCad }],
    effect: { kind: "releaseBy", roles: ["controller_admin"], maxCad: null },
  },
  P11: { when: [], effect: { kind: "invariant", name: "approverCannotRelease" }, locked: true },
  P12: {
    when: [{ field: "flag", op: "in", value: ["PO_OVER_BALANCE"] }],
    effect: { kind: "requireSteps", steps: ["finance_manager"] },
  },
  P13: {
    when: [
      { field: "vendor.requiresPo", op: "eq", value: true },
      { field: "poPresent", op: "eq", value: false },
    ],
    effect: { kind: "hold", flag: "PO_REQUIRED_MISSING" },
  },
};

/** Builds the structured rules from the CSV rows. Throws if a row has no mapping, or a mapping no row. */
export function policyRulesFrom(rows: ReadonlyArray<ApprovalPolicyRow>): PolicyRule[] {
  const ids = new Set(rows.map((r) => r.ruleId));
  const unmapped = rows.filter((r) => !POLICY_MAPPING[r.ruleId]).map((r) => r.ruleId);
  const orphan = Object.keys(POLICY_MAPPING).filter((id) => !ids.has(id));
  if (unmapped.length || orphan.length) {
    throw new Error(
      `approval_policies.csv and POLICY_MAPPING disagree. No mapping for: [${unmapped.join(", ")}]; ` +
        `no CSV row for: [${orphan.join(", ")}]`,
    );
  }
  return rows.map((r) => {
    const m = POLICY_MAPPING[r.ruleId];
    return {
      id: r.ruleId,
      type: r.ruleType,
      active: true,
      locked: m.locked ?? false,
      when: m.when,
      effect: m.effect,
      sourceText: `${r.condition} → ${r.required}`,
      note: r.notes ?? "",
    };
  });
}
