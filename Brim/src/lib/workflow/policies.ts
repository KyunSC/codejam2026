/**
 * Policy editor (BUILD_PLAN Approval routing, Server API, Screens):
 *
 * - listPolicies: GET /api/orgs/:slug/policies. Controller edits, auditor reads (matrix admin.read).
 *   Returns the rules as rows plus the dropdown choices the editor offers.
 * - updatePolicy: PUT /api/orgs/:slug/policies/:id (controller, admin.edit). A locked rule (P07, P08, P11)
 *   cannot change at all: 422 LOCKED_RULE. A condition or effect the routing code cannot evaluate: 422
 *   BAD_CONDITION. The change is audited with both values in the same transaction.
 * - previewPolicies: POST /api/orgs/:slug/policies/preview. "Try on an invoice": the chain and who may
 *   release under the rules in force and under the draft, using the same route function as submit.
 *
 * Steps are created at submit time, so an edit never rewrites an invoice already in flight.
 */
import type { Prisma, User } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { authorize, checkNotReadOnly, firstFailure } from "@/lib/auth/matrix";
import { AppError } from "@/lib/http";
import { type Condition, type Effect, type PolicyRule, STEP_RANK, type StepRole } from "@/lib/rules/routing/policy";
import type { FlagCode, Role } from "@/lib/types";
import { loadInvoice, previewFor } from "./approvals";
import { enforce, type WorkflowActor, workflowActor } from "./guard";
import { loadLiveRefs } from "./refs";

type Tx = Prisma.TransactionClient;

/** Every flag code, for the "flag in" dropdown and for validation (kept in step with types.ts by the check below). */
export const FLAG_CODES = [
  "UNREADABLE", "FIELD_UNCERTAIN", "ARITHMETIC_LINE", "ARITHMETIC_SUBTOTAL", "ARITHMETIC_TOTAL", "DATE_ODD",
  "DATE_AMBIGUOUS", "TERMS_MISMATCH", "FX_RATE_FALLBACK", "SHIP_TO_UNKNOWN", "VENDOR_UNKNOWN", "VENDOR_PENDING",
  "VENDOR_ON_HOLD", "VENDOR_NEW", "VENDOR_LOOKALIKE", "TAX_NUMBER_MISMATCH", "BANK_MISMATCH", "BANK_CHANGE_UNVERIFIED",
  "BANK_CHANGE_RECENT", "TAX_WRONG_FOR_PROVINCE", "TAX_AMOUNT", "TAX_NOT_REGISTERED", "CURRENCY_UNEXPECTED",
  "PO_REQUIRED_MISSING", "PO_NOT_FOUND", "PO_VENDOR_MISMATCH", "PO_CLOSED", "PO_OVER_BALANCE", "CONTRACT_EXPIRED",
  "CONTRACT_FEE_MISMATCH", "CONTRACT_RATE_OVER_CAP", "CONTRACT_FUEL_OVER_CAP", "CONTRACT_MONTHLY_CAP",
  "CONTRACT_PERIOD_REPEAT", "SPLIT_SUSPECTED", "REQUESTER_TERMINATED", "SELF_APPROVAL", "CREDIT_NOTE_ORPHAN",
  "DUP_FILE", "DUP_EXACT", "DUP_NEAR", "DUP_CONTENT", "DUP_PAID_BY_CARD", "SENDER_DOMAIN_MISMATCH",
  "SENDER_LOOKALIKE_DOMAIN",
] as const satisfies readonly FlagCode[];
// Compile-time: every FlagCode is listed.
type _AllFlags = Exclude<FlagCode, (typeof FLAG_CODES)[number]> extends never ? true : never;
const _allFlags: _AllFlags = true;
void _allFlags;

export const STEP_ROLES = Object.keys(STEP_RANK) as StepRole[];
const RELEASE_ROLES: Role[] = ["finance_manager", "controller_admin"];
const VENDOR_STATUSES = ["active", "pending_review", "on_hold"];

/** The condition fields the routing code evaluates, with the operators each allows and its value kind. */
export const CONDITION_FIELDS = {
  totalCad: { ops: ["gt", "lte"], value: "number", label: "Total (CAD incl. tax)" },
  "vendor.status": { ops: ["in"], value: "vendorStatus[]", label: "Vendor status" },
  "vendor.isNew": { ops: ["eq"], value: "boolean", label: "Vendor is new" },
  "vendor.category": { ops: ["in"], value: "category[]", label: "Vendor category" },
  "vendor.requiresPo": { ops: ["eq"], value: "boolean", label: "Vendor requires a PO" },
  department: { ops: ["in"], value: "department[]", label: "Department" },
  flag: { ops: ["in"], value: "flag[]", label: "Flag (open or overridden)" },
} as const;
type Field = keyof typeof CONDITION_FIELDS;

const bad = (msg: string): never => {
  throw new AppError(422, "BAD_CONDITION", msg);
};

export interface Choices {
  departments: Array<{ id: string; name: string }>;
  categories: string[];
}

function validateCondition(c: unknown, i: number, choices: Choices): Condition {
  if (!c || typeof c !== "object") return bad(`Condition ${i + 1}: not an object.`);
  const { field, op, value } = c as Record<string, unknown>;
  const spec = CONDITION_FIELDS[field as Field];
  if (!spec) return bad(`Condition ${i + 1}: unknown field "${String(field)}". Pick one of ${Object.keys(CONDITION_FIELDS).join(", ")}.`);
  if (!(spec.ops as readonly string[]).includes(op as string)) return bad(`Condition ${i + 1}: ${String(field)} takes ${spec.ops.join(" or ")}, not "${String(op)}".`);
  const list = (allowed: readonly string[], what: string) => {
    if (!Array.isArray(value) || value.length === 0) return bad(`Condition ${i + 1}: pick at least one ${what}.`);
    const unknown = value.filter((v) => !allowed.includes(v as string));
    if (unknown.length) return bad(`Condition ${i + 1}: unknown ${what} ${unknown.join(", ")}.`);
    return [...new Set(value as string[])];
  };
  switch (spec.value) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return bad(`Condition ${i + 1}: the amount must be a number of 0 or more.`);
      return { field: "totalCad", op: op as "gt" | "lte", value };
    case "boolean":
      if (typeof value !== "boolean") return bad(`Condition ${i + 1}: choose yes or no.`);
      return { field: field as "vendor.isNew" | "vendor.requiresPo", op: "eq", value };
    case "vendorStatus[]":
      return { field: "vendor.status", op: "in", value: list(VENDOR_STATUSES, "vendor status") };
    case "category[]":
      return { field: "vendor.category", op: "in", value: list(choices.categories, "category") };
    case "department[]":
      return { field: "department", op: "in", value: list(choices.departments.map((d) => d.id), "department") };
    case "flag[]":
      return { field: "flag", op: "in", value: list(FLAG_CODES, "flag") };
  }
}

/** The effect must match the rule's type and the routing code's shapes. */
function validateEffect(e: unknown, current: Effect): Effect {
  if (!e || typeof e !== "object") return bad("Effect: not an object.");
  const eff = e as Record<string, unknown>;
  if (eff.kind !== current.kind) return bad(`Effect: this rule's effect is "${current.kind}"; it cannot become "${String(eff.kind)}".`);
  if (eff.kind === "requireSteps") {
    const steps = eff.steps;
    if (!Array.isArray(steps) || steps.length === 0) return bad("Effect: pick at least one approval step.");
    const unknown = steps.filter((s) => !STEP_ROLES.includes(s as StepRole));
    if (unknown.length) return bad(`Effect: unknown step ${unknown.join(", ")}.`);
    return { kind: "requireSteps", steps: [...new Set(steps as StepRole[])].sort((a, b) => STEP_RANK[a] - STEP_RANK[b]) };
  }
  if (eff.kind === "releaseBy") {
    const roles = eff.roles;
    if (!Array.isArray(roles) || roles.length === 0) return bad("Effect: pick at least one role that may release.");
    const unknown = roles.filter((r) => !RELEASE_ROLES.includes(r as Role));
    if (unknown.length) return bad(`Effect: ${unknown.join(", ")} cannot hold release rights.`);
    const maxCad = eff.maxCad;
    if (maxCad !== null && (typeof maxCad !== "number" || !Number.isFinite(maxCad) || maxCad <= 0)) return bad("Effect: the release limit must be a positive number, or none.");
    return { kind: "releaseBy", roles: [...new Set(roles as Role[])], maxCad: maxCad as number | null };
  }
  if (eff.kind === "hold") {
    if (!FLAG_CODES.includes(eff.flag as FlagCode)) return bad(`Effect: unknown flag ${String(eff.flag)}.`);
    return { kind: "hold", flag: eff.flag as FlagCode };
  }
  return bad("Effect: invariants are fixed.");
}

export interface RuleDraft {
  active?: boolean;
  when?: unknown[];
  effect?: unknown;
  note?: string;
}

/** Applies a draft to a rule, or throws LOCKED_RULE / BAD_CONDITION. Returns the rule unchanged when the draft changes nothing. */
export function applyDraft(rule: PolicyRule, draft: RuleDraft, choices: Choices): PolicyRule {
  const next: PolicyRule = {
    ...rule,
    active: draft.active ?? rule.active,
    when: draft.when !== undefined ? (Array.isArray(draft.when) ? draft.when.map((c, i) => validateCondition(c, i, choices)) : bad("when must be a list of conditions.")) : rule.when,
    effect: draft.effect !== undefined ? validateEffect(draft.effect, rule.effect) : rule.effect,
    note: draft.note !== undefined ? String(draft.note) : rule.note,
  };
  if (draft.active !== undefined && typeof draft.active !== "boolean") bad("active must be true or false.");
  const changed = JSON.stringify(next) !== JSON.stringify(rule);
  if (changed && rule.locked) throw new AppError(422, "LOCKED_RULE", `${rule.id} is one of the brief's rules for every role; it cannot be changed or switched off.`);
  return next;
}

async function loadRules(tx: Tx, organizationId: string): Promise<PolicyRule[]> {
  const rows = await tx.policyRule.findMany({ where: { organizationId }, orderBy: { id: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as PolicyRule["type"],
    active: r.active,
    locked: r.locked,
    when: r.when as unknown as Condition[],
    effect: r.effect as unknown as Effect,
    sourceText: r.sourceText,
    note: r.note,
  }));
}

async function loadChoices(tx: Tx, organizationId: string): Promise<Choices> {
  const [departments, vendors] = await Promise.all([
    tx.department.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    tx.vendor.findMany({ where: { organizationId }, select: { category: true }, distinct: ["category"] }),
  ]);
  const categories = vendors.map((v) => v.category).sort();
  return { departments, categories };
}

function requireRead(user: User | null) {
  if (!user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
  const actor = workflowActor(user);
  enforce(authorize(actor.matrix, "admin.read"));
  return actor;
}

export async function listPolicies(tx: Tx, user: User | null) {
  const actor = requireRead(user);
  const org = user!.organizationId;
  const [rules, choices, rows] = await Promise.all([
    loadRules(tx, org),
    loadChoices(tx, org),
    tx.policyRule.findMany({ where: { organizationId: org }, select: { id: true, updatedById: true } }),
  ]);
  const editors = await tx.user.findMany({ where: { organizationId: org, id: { in: rows.map((r) => r.updatedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  return {
    canEdit: authorize(actor.matrix, "admin.edit").ok,
    rules: rules.map((r) => {
      const by = rows.find((x) => x.id === r.id)?.updatedById;
      return { ...r, updatedBy: by ? (editors.find((e) => e.id === by)?.fullName ?? by) : null };
    }),
    options: {
      fields: CONDITION_FIELDS,
      steps: STEP_ROLES,
      releaseRoles: RELEASE_ROLES,
      vendorStatuses: VENDOR_STATUSES,
      flags: FLAG_CODES,
      ...choices,
    },
  };
}

export async function updatePolicy(tx: Tx, actor: WorkflowActor, organizationId: string, id: string, draft: RuleDraft) {
  enforce(firstFailure(authorize(actor.matrix, "admin.edit"), checkNotReadOnly(actor.matrix)));
  const rules = await loadRules(tx, organizationId);
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new AppError(404, "POLICY_NOT_FOUND", `No policy rule ${id}.`);
  const next = applyDraft(rule, draft, await loadChoices(tx, organizationId));
  if (JSON.stringify(next) === JSON.stringify(rule)) return { rule, changed: false };
  await tx.policyRule.update({
    where: { organizationId_id: { organizationId, id } },
    data: {
      active: next.active,
      when: next.when as unknown as Prisma.InputJsonValue,
      effect: next.effect as unknown as Prisma.InputJsonValue,
      note: next.note,
      updatedById: actor.user.id,
    },
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "policy.update",
    entityType: "policy_rule",
    entityId: id,
    before: { active: rule.active, when: rule.when, effect: rule.effect, note: rule.note },
    after: { active: next.active, when: next.when, effect: next.effect, note: next.note },
  });
  return { rule: next, changed: true };
}

export interface PreviewRequest {
  invoiceId: string;
  /** Drafts by rule id; rules not named keep the version in force. */
  drafts: Record<string, RuleDraft>;
}

/** The chain and release eligibility for one invoice under the rules in force and under the draft. */
export async function previewPolicies(tx: Tx, user: User | null, req: PreviewRequest) {
  requireRead(user);
  const organizationId = user!.organizationId;
  if (!req.invoiceId) throw new AppError(422, "BAD_REQUEST", "Pick an invoice to try the draft on.");
  const row = await loadInvoice(tx, organizationId, req.invoiceId);
  const rules = await loadRules(tx, organizationId);
  const choices = await loadChoices(tx, organizationId);
  for (const id of Object.keys(req.drafts ?? {})) {
    if (!rules.some((r) => r.id === id)) throw new AppError(404, "POLICY_NOT_FOUND", `No policy rule ${id}.`);
  }
  const draftRules = rules.map((r) => (req.drafts?.[r.id] ? applyDraft(r, req.drafts[r.id], choices) : r));
  const refs = await loadLiveRefs(tx, organizationId, { self: { invoiceId: row.id, receivedDate: row.receivedDate, status: row.status } });
  const before = previewFor(row, refs);
  const after = previewFor(row, { ...refs, policyRules: draftRules });
  const changedRules = draftRules.filter((r, i) => JSON.stringify(r) !== JSON.stringify(rules[i])).map((r) => r.id);
  return { invoiceId: row.id, changedRules, before, after };
}
