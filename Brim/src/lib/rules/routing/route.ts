/**
 * From rules to people (BUILD_PLAN Approval routing → From rules to people):
 *   1. Collect the step roles of every active approval rule whose conditions hold. Add finance_manager
 *      when any policy or fraud flag was overridden. Remove repeats, sort by rank.
 *   2. Resolve each role: dept_manager → the department's manager; finance_manager → the user with that
 *      role; controller_admin → the controller who is not the CFO; cfo → the controller with no manager.
 *   3. Self-approval: the invoice's requester is replaced by their manager.
 *   4. Leave: an on-leave person is replaced by their delegate, stored as onBehalfOf; the step keeps the
 *      absent person's limit.
 *   5. Terminated: replaced by their manager.
 *   6. Repeats: a person who already holds an earlier step of this chain is replaced by their manager.
 *   7. A replacement with nobody to go to makes the step unresolvable; the invoice is held with the reason.
 *   8. Every step stores why: the rule ids and each replacement made.
 * Release (P09–P11): the roles whose band covers the amount, minus everyone who approved (in their own name
 * or as the person a delegate acted for). When that leaves nobody, release is blocked and says so.
 */
import type Decimal from "decimal.js";
import type { UserRow, VendorRow } from "../../dataset";
import type { Flag, FlagCode, ResolvedInvoice } from "../../types";
import { findSplit } from "../checks/people";
import { money } from "../format";
import type { Refs } from "../refs";
import { effectiveRequester } from "../resolve/fields";
import { type Condition, type PolicyRule, releaseRoles, STEP_RANK, type StepRole } from "./policy";

export interface RoutingInput {
  /**
   * CAD total incl. tax; for a suspected split, the combined amount. Null when unknown (e.g. a USD invoice
   * with no rate): the route then takes every amount-based step and is blocked until the total is known.
   */
  totalCad: number | null;
  departmentId: string | null;
  requesterId: string | null;
  vendor: Pick<VendorRow, "status" | "category" | "requiresPo"> | null;
  /** Codes of open or overridden flags. */
  flags: readonly FlagCode[];
  /** Codes of policy or fraud flags a person overrode (each adds a finance manager step). */
  overridden: readonly FlagCode[];
}

export interface RouteStep {
  stepNo: number;
  role: StepRole;
  /** Who acts; null when unresolvable. */
  assignedToId: string | null;
  /** The absent approver a delegate acts for. */
  onBehalfOfId: string | null;
  /** The limit of the person the step is for (the absent person's, when delegated). */
  limitCad: number | null;
  ruleIds: string[];
  replacements: string[];
  unresolvable: string | null;
}

export interface Route {
  steps: RouteStep[];
  /** Hold effects from match rules (P13). */
  holds: Array<{ ruleId: string; flag: FlagCode }>;
  /** Reasons the invoice cannot be submitted as routed. */
  blocked: string[];
}

function holds(c: Condition, input: RoutingInput): boolean {
  switch (c.field) {
    case "totalCad":
      // Unknown total: assume the largest, so no step is missed.
      if (input.totalCad === null) return c.op === "gt";
      return c.op === "gt" ? input.totalCad > c.value : input.totalCad <= c.value;
    case "vendor.status":
      return !!input.vendor && c.value.includes(input.vendor.status);
    case "vendor.isNew":
      return input.flags.includes("VENDOR_NEW") === c.value;
    case "vendor.category":
      return !!input.vendor && c.value.includes(input.vendor.category);
    case "vendor.requiresPo":
      return !!input.vendor && input.vendor.requiresPo === c.value;
    case "department":
      return !!input.departmentId && c.value.includes(input.departmentId);
    case "flag":
      return c.value.some((f) => input.flags.includes(f as FlagCode));
  }
}

const applies = (r: PolicyRule, input: RoutingInput) => r.active && r.when.every((c) => holds(c, input));
const invariantOn = (rules: readonly PolicyRule[], name: string) =>
  rules.some((r) => r.effect.kind === "invariant" && r.effect.name === name && (r.active || r.locked));

const who = (u: UserRow | undefined, id: string | null) => (u ? `${u.userId} ${u.fullName}` : (id ?? "nobody"));

/** The person a step role resolves to before any replacement. */
function resolveRole(role: StepRole, input: RoutingInput, refs: Refs): { userId: string | null; why: string } {
  const users = refs.userList;
  switch (role) {
    case "dept_manager": {
      const d = input.departmentId ? refs.departments.get(input.departmentId) : undefined;
      return d ? { userId: d.managerUserId, why: `manager of ${d.departmentId} ${d.name}` } : { userId: null, why: "the invoice has no department" };
    }
    case "finance_manager": {
      const u = users.find((x) => x.role === "finance_manager" && x.status !== "terminated");
      return { userId: u?.userId ?? null, why: "the finance manager" };
    }
    case "controller_admin": {
      const u = users.find((x) => x.role === "controller_admin" && x.managerId && x.status !== "terminated");
      return { userId: u?.userId ?? null, why: "the controller (not the CFO)" };
    }
    case "cfo": {
      const u = users.find((x) => x.role === "controller_admin" && !x.managerId && x.status !== "terminated");
      return { userId: u?.userId ?? null, why: "the CFO (controller with no manager)" };
    }
  }
}

export function route(input: RoutingInput, rules: readonly PolicyRule[], refs: Refs): Route {
  // 1. Step roles, with the rules that require each.
  const byRole = new Map<StepRole, string[]>();
  for (const r of rules) {
    if (r.effect.kind !== "requireSteps" || !applies(r, input)) continue;
    for (const s of r.effect.steps) byRole.set(s, [...(byRole.get(s) ?? []), r.id]);
  }
  if (input.overridden.length) byRole.set("finance_manager", [...(byRole.get("finance_manager") ?? []), `override of ${input.overridden.join(", ")}`]);
  const roles = [...byRole.keys()].sort((a, b) => STEP_RANK[a] - STEP_RANK[b]);

  const noSelf = invariantOn(rules, "noSelfApproval");
  const delegate = invariantOn(rules, "delegateWhenOnLeave");
  const requester = effectiveRequester(input.requesterId, refs);
  const steps: RouteStep[] = [];
  const blocked: string[] = [];
  if (input.totalCad === null) blocked.push("The CAD total is unknown, so the approval amount cannot be set; every amount-based step is included until it is known.");

  for (const role of roles) {
    const start = resolveRole(role, input, refs);
    const step: RouteStep = {
      stepNo: steps.length + 1,
      role,
      assignedToId: start.userId,
      onBehalfOfId: null,
      limitCad: null,
      ruleIds: byRole.get(role)!,
      replacements: [],
      unresolvable: start.userId ? null : `No ${role.replace("_", " ")}: ${start.why}.`,
    };
    const startUser = start.userId ? refs.users.get(start.userId) : undefined;
    step.limitCad = startUser ? startUser.approvalLimitCad.toNumber() : null;

    const toManager = (reason: string) => {
      const cur = refs.users.get(step.assignedToId!);
      const mgr = cur?.managerId ? refs.users.get(cur.managerId) : undefined;
      if (!mgr) {
        step.unresolvable = `${who(cur, step.assignedToId)} ${reason}, and has no manager to take the step.`;
        step.assignedToId = null;
        return;
      }
      step.replacements.push(`${who(cur, step.assignedToId)} ${reason} → manager ${who(mgr, mgr.userId)}`);
      step.assignedToId = mgr.userId;
      step.onBehalfOfId = null; // the manager acts in their own name, not for the absent person
      step.limitCad = mgr.approvalLimitCad.toNumber();
    };

    // 3–6, repeated until nothing changes (a replacement can itself be the requester, absent or a repeat).
    // A person reached twice means the replacements go round in a circle: the step is unresolvable.
    const seen = new Set<string>();
    let settled = false;
    while (step.assignedToId) {
      if (seen.has(step.assignedToId)) {
        step.unresolvable = `The replacements for this step go round in a circle (${[...seen].join(" → ")} → ${step.assignedToId}).`;
        step.assignedToId = null;
        step.onBehalfOfId = null;
        break;
      }
      seen.add(step.assignedToId);
      const u = refs.users.get(step.assignedToId);
      if (!u) {
        step.unresolvable = `User ${step.assignedToId} does not exist.`;
        step.assignedToId = null;
        break;
      }
      if (noSelf && requester && u.userId === requester) toManager("requested this invoice (P07)");
      else if (u.status === "on_leave" && delegate) {
        const d = u.delegateUserId ? refs.users.get(u.delegateUserId) : undefined;
        if (!d) toManager("is on leave with no delegate");
        else {
          step.replacements.push(`${who(u, u.userId)} is on leave → delegate ${who(d, d.userId)} acts on their behalf (P08)`);
          step.onBehalfOfId ??= u.userId; // the step keeps the absent person's limit
          step.assignedToId = d.userId;
        }
      } else if (u.status === "terminated") toManager("has left the company");
      else if (steps.some((s) => s.assignedToId === u.userId)) toManager(`already holds step ${steps.find((s) => s.assignedToId === u.userId)!.stepNo} of this chain`);
      else {
        settled = true;
        break;
      }
    }
    if (!settled && !step.unresolvable) step.unresolvable = "No one could be found to take this step.";
    if (step.unresolvable) blocked.push(`Step ${step.stepNo} (${role}): ${step.unresolvable}`);
    steps.push(step);
  }

  const holdsOut = rules.filter((r) => r.effect.kind === "hold" && applies(r, input)).map((r) => ({ ruleId: r.id, flag: (r.effect as { flag: FlagCode }).flag }));
  return { steps, holds: holdsOut, blocked };
}

export interface ReleaseEligibility {
  /** Who may release, best rank first. Empty when nobody may. */
  releaserIds: string[];
  ruleIds: string[];
  /** Set when nobody may release, saying why. */
  blockedReason: string | null;
}

/**
 * Who may release a payment of `amountCad` once the chain has approved. Approvers (and anyone a delegate
 * acted for) are excluded (P11). Only active users count.
 */
export function releaseEligibility(amountCad: number, steps: readonly Pick<RouteStep, "assignedToId" | "onBehalfOfId">[], rules: readonly PolicyRule[], refs: Refs): ReleaseEligibility {
  const { roles, ruleIds } = releaseRoles(amountCad, rules);
  const approvers = new Set(steps.flatMap((s) => [s.assignedToId, s.onBehalfOfId]).filter((x): x is string => !!x));
  const rank: Record<string, number> = { finance_manager: 0, controller_admin: 1 };
  const eligible = refs.userList
    .filter((u) => roles.has(u.role) && u.status === "active")
    .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || (a.managerId ? 0 : 1) - (b.managerId ? 0 : 1) || a.userId.localeCompare(b.userId));
  const releaserIds = eligible.filter((u) => !invariantOn(rules, "approverCannotRelease") || !approvers.has(u.userId)).map((u) => u.userId);
  return {
    releaserIds,
    ruleIds,
    blockedReason: releaserIds.length
      ? null
      : `Nobody may release ${money(amountCad)}: everyone allowed to (${eligible.map((u) => u.userId).join(", ") || "no one"}) approved this invoice, and an approver cannot release its payment (P11).`,
  };
}

/** Builds the routing input for a resolved invoice and its flags (a suspected split routes as the combined amount). */
export function routingInputFor(inv: ResolvedInvoice, flags: readonly Flag[], refs: Refs, overridden: readonly FlagCode[] = []): RoutingInput {
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  const split = findSplit(inv, refs);
  const own: Decimal | null = inv.totalCad;
  // Unknown own total: unknown routing amount (never $0), even when a split is suspected.
  const total = own ? Math.max(own.toNumber(), split ? split.combinedCad.toNumber() : 0) : null;
  return {
    totalCad: total,
    departmentId: inv.departmentId,
    requesterId: inv.requesterId,
    vendor: vendor ?? null,
    flags: flags.map((f) => f.code),
    overridden,
  };
}
