/**
 * Roles and permissions (BUILD_PLAN "Roles and permissions"). One matrix; the server guard and the
 * UI both read it. Pure functions: no session, no database.
 *
 * Order of checks in every service function:
 *   1. `authorize(actor, action, ctx)`: the matrix, including scope (own submission, own department,
 *      own step) → `FORBIDDEN`.
 *   2. The invariants below, for every role → `SELF_APPROVAL`, `NOT_YOUR_STEP`,
 *      `APPROVER_CANNOT_RELEASE`, `RELEASE_LIMIT`, `FOUR_EYES`, `READ_ONLY_ROLE`.
 */
import Decimal from "decimal.js";
import { config } from "../config";
import { type PolicyRule, releaseLimitFor } from "../rules/routing/policy";
import type { Role } from "../types";

export const ROLES: readonly Role[] = [
  "employee",
  "ap_clerk",
  "approver",
  "finance_manager",
  "controller_admin",
  "auditor",
];

export type Action =
  | "invoice.read"
  | "invoice.upload"
  | "inbox.ingest"
  | "invoice.edit"
  | "flag.resolve.data_policy"
  | "flag.resolve.fraud"
  | "invoice.submit"
  | "invoice.decide"
  | "delegate.set_own"
  | "payment.prepare"
  | "payment.release"
  | "vendor.read"
  | "vendor.onboard"
  | "vendor.bank_change.request"
  | "vendor.approve"
  | "vendor.bank_change.verify"
  | "admin.edit"
  | "admin.read"
  | "spend.read"
  | "audit.read";

/**
 * How far a role's permission reaches.
 * - all: every record
 * - own_submissions: invoices the actor uploaded
 * - own_department: records of the actor's department
 * - own_department_or_step: own department, plus invoices with a step assigned to the actor
 * - own_step: only the step assigned to the actor (decided by the NOT_YOUR_STEP invariant)
 * - up_to_limit: release within `config.release.financeManagerMaxCad` (RELEASE_LIMIT invariant)
 */
export type Scope =
  | "all"
  | "own_submissions"
  | "own_department"
  | "own_department_or_step"
  | "own_step"
  | "up_to_limit";

type Matrix = Record<Action, Partial<Record<Role, Scope>>>;

/** BUILD_PLAN's table, row by row. A missing role means no access. */
export const MATRIX: Matrix = {
  "invoice.read": {
    employee: "own_submissions",
    ap_clerk: "all",
    approver: "own_department_or_step",
    finance_manager: "all",
    controller_admin: "all",
    auditor: "all",
  },
  "invoice.upload": { employee: "own_department", ap_clerk: "all" },
  "inbox.ingest": { ap_clerk: "all" },
  "invoice.edit": { ap_clerk: "all" },
  "flag.resolve.data_policy": { ap_clerk: "all" },
  "flag.resolve.fraud": { finance_manager: "all", controller_admin: "all" },
  "invoice.submit": { ap_clerk: "all" },
  "invoice.decide": { approver: "own_step", finance_manager: "own_step", controller_admin: "own_step" },
  "delegate.set_own": { approver: "all", finance_manager: "all", controller_admin: "all" },
  "payment.prepare": { ap_clerk: "all" },
  "payment.release": { finance_manager: "up_to_limit", controller_admin: "all" },
  "vendor.read": {
    employee: "all",
    ap_clerk: "all",
    approver: "all",
    finance_manager: "all",
    controller_admin: "all",
    auditor: "all",
  },
  "vendor.onboard": { ap_clerk: "all" },
  "vendor.bank_change.request": { ap_clerk: "all" },
  "vendor.approve": { finance_manager: "all", controller_admin: "all" },
  "vendor.bank_change.verify": { finance_manager: "all", controller_admin: "all" },
  "admin.edit": { controller_admin: "all" },
  "admin.read": { controller_admin: "all", auditor: "all" },
  "spend.read": { approver: "own_department", finance_manager: "all", controller_admin: "all", auditor: "all" },
  "audit.read": { controller_admin: "all", auditor: "all" },
};

/** Actions that change something. The auditor holds none of them; READ_ONLY_ROLE backs that up. */
export const MUTATING_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "invoice.upload",
  "inbox.ingest",
  "invoice.edit",
  "flag.resolve.data_policy",
  "flag.resolve.fraud",
  "invoice.submit",
  "invoice.decide",
  "delegate.set_own",
  "payment.prepare",
  "payment.release",
  "vendor.onboard",
  "vendor.bank_change.request",
  "vendor.approve",
  "vendor.bank_change.verify",
  "admin.edit",
]);

/** Which vendor fields a role sees ("Read vendors" row). */
export type VendorView = "names" | "bank_last4" | "no_bank" | "full";
export const VENDOR_VIEW: Record<Role, VendorView> = {
  employee: "names",
  ap_clerk: "bank_last4",
  approver: "no_bank",
  finance_manager: "full",
  controller_admin: "full",
  auditor: "full",
};

export interface Actor {
  userId: string;
  role: Role;
  departmentId: string;
}

/** What the matrix needs to know about the record, when the scope depends on it. */
export interface AccessContext {
  /** The department of the invoice, upload or spend report. */
  departmentId?: string | null;
  /** Who uploaded the invoice (employee submissions). */
  submittedById?: string | null;
  /** Everyone holding a step on the invoice, in their own name or as a delegate. */
  stepAssigneeIds?: readonly string[];
}

export type ErrorCode =
  | "FORBIDDEN"
  | "SELF_APPROVAL"
  | "NOT_YOUR_STEP"
  | "APPROVER_CANNOT_RELEASE"
  | "RELEASE_LIMIT"
  | "FOUR_EYES"
  | "READ_ONLY_ROLE";

export type Decision = { ok: true } | { ok: false; code: ErrorCode; message: string };

const OK: Decision = { ok: true };
const deny = (code: ErrorCode, message: string): Decision => ({ ok: false, code, message });

export function scopeOf(role: Role, action: Action): Scope | null {
  return MATRIX[action][role] ?? null;
}

/**
 * The matrix check. `own_step` and `up_to_limit` pass here; the NOT_YOUR_STEP and RELEASE_LIMIT
 * invariants decide them with the step and the amount in hand.
 */
export function authorize(actor: Actor, action: Action, ctx: AccessContext = {}): Decision {
  if (actor.role === "auditor" && MUTATING_ACTIONS.has(action)) {
    return deny("READ_ONLY_ROLE", "The auditor role is read-only.");
  }
  const scope = scopeOf(actor.role, action);
  const no = deny("FORBIDDEN", `Role ${actor.role} may not ${action}.`);
  if (!scope) return no;
  switch (scope) {
    case "all":
    case "own_step":
    case "up_to_limit":
      return OK;
    case "own_submissions":
      return ctx.submittedById === actor.userId ? OK : no;
    case "own_department":
      return ctx.departmentId === actor.departmentId ? OK : no;
    case "own_department_or_step":
      return ctx.departmentId === actor.departmentId || (ctx.stepAssigneeIds ?? []).includes(actor.userId) ? OK : no;
  }
}

/** UI helper: whether the role ever has the action, ignoring scope. */
export function roleCan(role: Role, action: Action): boolean {
  return scopeOf(role, action) !== null;
}

// ---------- Invariants (every role, after the matrix) ----------

/** A step as the invariants see it. */
export interface StepRecord {
  assignedToId: string;
  /** The absent approver this step is held for, when delegated. */
  onBehalfOfId: string | null;
  decision: "pending" | "approved" | "rejected";
  decidedById: string | null;
}

/** P07 / rule 2: nobody approves an invoice they requested. */
export function checkNotRequester(actor: Actor, requesterId: string | null): Decision {
  return requesterId && requesterId === actor.userId
    ? deny("SELF_APPROVAL", "You requested this invoice, so you cannot approve it. It goes to your manager.")
    : OK;
}

/** Only the person the current step is assigned to may decide it. */
export function checkIsAssignee(actor: Actor, step: StepRecord | null): Decision {
  return step && step.decision === "pending" && step.assignedToId === actor.userId
    ? OK
    : deny("NOT_YOUR_STEP", "The current approval step is not assigned to you.");
}

/** P11 / rule 3: anyone who approved the invoice, in their own name or as a delegate, cannot release it. */
export function checkDidNotApprove(actor: Actor, steps: readonly StepRecord[]): Decision {
  const approved = steps.some(
    (s) => s.decision === "approved" && (s.decidedById === actor.userId || s.onBehalfOfId === actor.userId),
  );
  return approved
    ? deny("APPROVER_CANNOT_RELEASE", "You approved this invoice, so you cannot release its payment.")
    : OK;
}

/**
 * P09 / P10: the most this role may release. With the policy rules in force (the PolicyRule table), their
 * release bands decide, so an admin's edit applies here too. Without them, the seed defaults: finance
 * manager up to the configured limit, controller any amount, nobody else.
 */
export function releaseLimitCad(role: Role, rules?: readonly PolicyRule[]): number | null {
  if (rules) return releaseLimitFor(role, rules);
  if (role === "controller_admin") return Infinity;
  if (role === "finance_manager") return config.release.financeManagerMaxCad;
  return null;
}

export function checkReleaseLimit(actor: Actor, amountCad: Decimal | number, rules?: readonly PolicyRule[]): Decision {
  const limit = releaseLimitCad(actor.role, rules);
  const amount = new Decimal(amountCad);
  if (limit === null) return deny("RELEASE_LIMIT", `Role ${actor.role} has no release limit.`);
  return amount.lte(limit)
    ? OK
    : deny("RELEASE_LIMIT", `This payment is $${amount.toFixed(2)} CAD; your release limit is $${limit.toFixed(2)}.`);
}

/** The person approving a vendor or verifying a bank change did not request it. */
export function checkFourEyes(actor: Actor, requestedById: string | null): Decision {
  return requestedById && requestedById === actor.userId
    ? deny("FOUR_EYES", "You requested this change, so a second person must approve it.")
    : OK;
}

/** The auditor changes nothing. */
export function checkNotReadOnly(actor: Actor): Decision {
  return actor.role === "auditor" ? deny("READ_ONLY_ROLE", "The auditor role is read-only.") : OK;
}

/** First failing decision, or ok. */
export function firstFailure(...decisions: Decision[]): Decision {
  return decisions.find((d) => !d.ok) ?? OK;
}

/** Approve or reject: matrix, read-only, own step, not the requester. */
export function canDecideStep(
  actor: Actor,
  step: StepRecord | null,
  requesterId: string | null,
): Decision {
  return firstFailure(
    authorize(actor, "invoice.decide"),
    checkNotReadOnly(actor),
    checkIsAssignee(actor, step),
    checkNotRequester(actor, requesterId),
  );
}

/** Release: matrix, read-only, did not approve, within limit (from `rules`, the policy rules in force, when given). */
export function canRelease(actor: Actor, steps: readonly StepRecord[], amountCad: Decimal | number, rules?: readonly PolicyRule[]): Decision {
  return firstFailure(
    authorize(actor, "payment.release"),
    checkNotReadOnly(actor),
    checkDidNotApprove(actor, steps),
    checkReleaseLimit(actor, amountCad, rules),
  );
}
