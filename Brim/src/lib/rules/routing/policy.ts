/**
 * Policy rows (BUILD_PLAN Approval routing → Policy rows). The 13 CSV conditions are free text; each
 * rule_id is mapped here by hand to a structured row, keeping the original text for display. The seed
 * writes these to the PolicyRule table; at runtime the table wins, and the route function takes the
 * rules as an argument so the policy editor can preview a draft set.
 */
import { config } from "../../config";
import type { ApprovalPolicyRow } from "../../dataset";
import type { FlagCode, Role } from "../../types";

/** Ranked in this order. */
export type StepRole = "dept_manager" | "finance_manager" | "controller_admin" | "cfo";
export const STEP_RANK: Record<StepRole, number> = { dept_manager: 0, finance_manager: 1, controller_admin: 2, cfo: 3 };

export type Condition =
  | { field: "totalCad"; op: "gt" | "lte"; value: number }
  | { field: "vendor.status"; op: "in"; value: string[] }
  | { field: "vendor.isNew"; op: "eq"; value: boolean }
  | { field: "vendor.category"; op: "in"; value: string[] }
  | { field: "vendor.requiresPo"; op: "eq"; value: boolean }
  | { field: "department"; op: "in"; value: string[] }
  /** An open or overridden flag code. */
  | { field: "flag"; op: "in"; value: string[] };

export type Effect =
  | { kind: "requireSteps"; steps: StepRole[] }
  | { kind: "hold"; flag: FlagCode }
  | { kind: "releaseBy"; roles: Role[]; maxCad: number | null }
  | { kind: "invariant"; name: "noSelfApproval" | "delegateWhenOnLeave" | "approverCannotRelease" };

export interface PolicyRule {
  id: string;
  type: "approval" | "payment_release" | "match";
  active: boolean;
  locked: boolean;
  /** All must hold (an empty list always holds). */
  when: Condition[];
  effect: Effect;
  sourceText: string;
  note: string;
}

const A = config.approval;

/** The structured form of each rule id. P05's "pending or new" is read from the flags that state it. */
const STRUCTURED: Record<string, Pick<PolicyRule, "type" | "locked" | "when" | "effect">> = {
  P01: { type: "approval", locked: false, when: [{ field: "totalCad", op: "lte", value: A.deptManagerMaxCad }], effect: { kind: "requireSteps", steps: ["dept_manager"] } },
  P02: { type: "approval", locked: false, when: [{ field: "totalCad", op: "gt", value: A.deptManagerMaxCad }], effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager"] } },
  P03: { type: "approval", locked: false, when: [{ field: "totalCad", op: "gt", value: A.controllerAboveCad }], effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager", "controller_admin"] } },
  P04: { type: "approval", locked: false, when: [{ field: "totalCad", op: "gt", value: A.cfoAboveCad }], effect: { kind: "requireSteps", steps: ["dept_manager", "finance_manager", "controller_admin", "cfo"] } },
  P05: { type: "approval", locked: false, when: [{ field: "flag", op: "in", value: ["VENDOR_PENDING", "VENDOR_NEW"] }], effect: { kind: "requireSteps", steps: ["finance_manager"] } },
  P06: { type: "approval", locked: false, when: [{ field: "vendor.category", op: "in", value: [...A.financeReviewCategories] }], effect: { kind: "requireSteps", steps: ["finance_manager"] } },
  P07: { type: "approval", locked: true, when: [], effect: { kind: "invariant", name: "noSelfApproval" } },
  P08: { type: "approval", locked: true, when: [], effect: { kind: "invariant", name: "delegateWhenOnLeave" } },
  P09: { type: "payment_release", locked: false, when: [], effect: { kind: "releaseBy", roles: ["finance_manager", "controller_admin"], maxCad: config.release.financeManagerMaxCad } },
  P10: { type: "payment_release", locked: false, when: [], effect: { kind: "releaseBy", roles: ["controller_admin"], maxCad: null } },
  P11: { type: "payment_release", locked: true, when: [], effect: { kind: "invariant", name: "approverCannotRelease" } },
  P12: { type: "match", locked: false, when: [{ field: "flag", op: "in", value: ["PO_OVER_BALANCE"] }], effect: { kind: "requireSteps", steps: ["finance_manager"] } },
  P13: { type: "match", locked: false, when: [{ field: "vendor.requiresPo", op: "eq", value: true }, { field: "flag", op: "in", value: ["PO_REQUIRED_MISSING"] }], effect: { kind: "hold", flag: "PO_REQUIRED_MISSING" } },
};

/** The seed: each CSV row mapped to its structured rule, original text kept. */
export function policyRulesFromCsv(rows: readonly ApprovalPolicyRow[]): PolicyRule[] {
  return rows.map((r) => {
    const s = STRUCTURED[r.ruleId];
    if (!s) throw new Error(`approval_policies.csv: no structured mapping for ${r.ruleId}`);
    return { id: r.ruleId, active: true, ...s, sourceText: `${r.condition} → ${r.required}`, note: r.notes ?? "" };
  });
}

/** Release rules (P09/P10) as eligibility bands: roles that may release a payment of this size. */
export function releaseRoles(amountCad: number, rules: readonly PolicyRule[]): { roles: Set<Role>; ruleIds: string[] } {
  const roles = new Set<Role>();
  const ruleIds: string[] = [];
  for (const r of rules) {
    if (!r.active || r.effect.kind !== "releaseBy") continue;
    const { maxCad } = r.effect;
    if (maxCad !== null && amountCad > maxCad) continue;
    r.effect.roles.forEach((x) => roles.add(x));
    ruleIds.push(r.id);
  }
  return { roles, ruleIds };
}
