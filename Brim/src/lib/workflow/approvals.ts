/**
 * Approvals (BUILD_PLAN Approval routing, Server API):
 *
 * - routePreview: the chain the routing rules give this invoice now, and who could release it.
 * - submit (AP clerk): 422 OPEN_FLAGS while a hold flag is open, CODING_INCOMPLETE while a line has
 *   no final account, STEP_UNRESOLVABLE when a step has nobody to take it or nobody could release the
 *   payment afterwards. Creates one ApprovalStep row per step (rule ids and replacements in `why`) and
 *   moves the invoice to pending_approval.
 * - decide (the current step's assignee, or the delegate of an assignee now on leave): approve or
 *   reject. 403 NOT_YOUR_STEP, SELF_APPROVAL; 409 VERSION_CONFLICT. A delegate's decision records the
 *   absent person as onBehalfOf on the step and in the audit row.
 * - setDelegation: an approver, finance manager or controller names their own delegate (and leave).
 *
 * Routing itself is src/lib/rules/routing/route.ts; this file only loads its inputs and stores steps.
 */
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { canDecideStep, type StepRecord } from "@/lib/auth/matrix";
import { AppError } from "@/lib/http";
import { bumpInvoiceVersion, transitionInvoice } from "@/lib/invoices/transition";
import { releaseEligibility, type Route, route, routingInputFor, type RoutingInput } from "@/lib/rules/routing/route";
import type { Flag, FlagCode } from "@/lib/types";
import { enforce, type WorkflowActor } from "./guard";
import { resolveStored } from "./process";
import { type LiveRefs, loadLiveRefs } from "./refs";

type Tx = Prisma.TransactionClient;

export const REJECTION_REASONS = [
  "Pricing does not match quote",
  "Goods not received",
  "Duplicate - already submitted",
  "Wrong cost centre",
  "Coding incorrect",
] as const;

async function loadInvoice(tx: Tx, organizationId: string, invoiceId: string) {
  const row = await tx.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      flags: true,
      approvalSteps: { orderBy: { stepNo: "asc" } },
      createdBy: { select: { role: true, externalId: true, id: true } },
    },
  });
  if (!row) throw new AppError(404, "INVOICE_NOT_FOUND", `No invoice ${invoiceId}.`);
  return row;
}
type InvoiceRow = Awaited<ReturnType<typeof loadInvoice>>;

/** The routing input for a stored invoice: from its resolution when it was extracted, else its columns. */
export function routingInputForRow(row: InvoiceRow, refs: LiveRefs): RoutingInput {
  const requester = refs.people.toPerson(row.requesterId);
  const live = row.flags.filter((f) => f.status === "open" || f.status === "overridden");
  const overridden = row.flags
    .filter((f) => f.status === "overridden" && (f.klass === "policy" || f.klass === "fraud"))
    .map((f) => f.code as FlagCode);
  const flags = live.map((f) => ({ code: f.code }) as Flag);
  if (row.normalized) {
    const { resolved } = resolveStored(row, refs);
    // The stored columns are what the clerk last saw; they win over a fresh resolution.
    const inv = {
      ...resolved,
      departmentId: row.departmentId ?? resolved.departmentId,
      requesterId: requester ?? resolved.requesterId,
      vendorId: row.vendorId ?? resolved.vendorId,
      totalCad: row.totalCad ? new Decimal(row.totalCad.toString()) : resolved.totalCad,
    };
    return routingInputFor(inv, flags, refs, overridden);
  }
  const vendor = row.vendorId ? refs.vendors.get(row.vendorId) : undefined;
  return {
    totalCad: row.totalCad ? Number(row.totalCad) : null,
    departmentId: row.departmentId,
    requesterId: requester,
    vendor: vendor ?? null,
    flags: flags.map((f) => f.code),
    overridden,
  };
}

export interface Preview {
  route: Route;
  release: ReturnType<typeof releaseEligibility>;
  input: RoutingInput;
}

export function previewFor(row: InvoiceRow, refs: LiveRefs): Preview {
  const input = routingInputForRow(row, refs);
  const r = route(input, refs.policyRules, refs);
  const release = releaseEligibility(input.totalCad ?? 0, r.steps, refs.policyRules, refs);
  return { route: r, release, input };
}

export async function routePreview(tx: Tx, organizationId: string, invoiceId: string): Promise<Preview> {
  const row = await loadInvoice(tx, organizationId, invoiceId);
  const refs = await loadLiveRefs(tx, organizationId, { self: { invoiceId, receivedDate: row.receivedDate, status: row.status } });
  return previewFor(row, refs);
}


export async function submit(tx: Tx, actor: WorkflowActor, organizationId: string, invoiceId: string, ifMatch: number | null) {
  const row = await loadInvoice(tx, organizationId, invoiceId);
  if (ifMatch !== null && ifMatch !== row.version) {
    throw new AppError(409, "VERSION_CONFLICT", `Invoice ${invoiceId} changed since you opened it. Reload and try again.`);
  }
  if (row.status !== "coded") {
    throw new AppError(409, "INVALID_STATE", `Invoice ${invoiceId} is ${row.status}; only a coded invoice is submitted.`);
  }
  const holds = row.flags.filter((f) => f.status === "open" && f.effect === "hold");
  if (holds.length) {
    throw new AppError(422, "OPEN_FLAGS", `Resolve these first: ${holds.map((f) => f.code).join(", ")}.`);
  }
  const uncoded = row.lines.filter((l) => !l.glFinal);
  if (row.lines.length === 0 || uncoded.length) {
    throw new AppError(
      422,
      "CODING_INCOMPLETE",
      row.lines.length === 0
        ? "The invoice has no lines to code."
        : `Accept or set the account on line${uncoded.length > 1 ? "s" : ""} ${uncoded.map((l) => l.lineNo).join(", ")}.`,
    );
  }
  const refs = await loadLiveRefs(tx, organizationId, { self: { invoiceId, receivedDate: row.receivedDate, status: row.status } });
  const { route: r, release } = previewFor(row, refs);
  const blocked = [...r.blocked];
  if (release.blockedReason) blocked.push(release.blockedReason);
  if (blocked.length || r.steps.length === 0) {
    throw new AppError(422, "STEP_UNRESOLVABLE", blocked.join(" ") || "No approval rule applies to this invoice.");
  }

  await tx.approvalStep.deleteMany({ where: { invoiceId, organizationId } });
  for (const s of r.steps) {
    await tx.approvalStep.create({
      data: {
        organizationId,
        id: `${invoiceId}-S${s.stepNo}-v${row.version}`,
        invoiceId,
        stepNo: s.stepNo,
        role: s.role,
        // Stored as User row ids, like the imported history.
        assignedToId: refs.people.toRow(s.assignedToId)!,
        onBehalfOfId: refs.people.toRow(s.onBehalfOfId),
        limitCad: String(s.limitCad ?? 0),
        why: { ruleIds: s.ruleIds, replacements: s.replacements } as Prisma.InputJsonValue,
      },
    });
  }
  const first = r.steps[0];
  await transitionInvoice(tx, {
    organizationId,
    invoiceId,
    to: "pending_approval",
    actor: actor.audit,
    action: "invoice.submit",
    expectedVersion: row.version,
    data: { assignedToId: refs.people.toRow(first.assignedToId) },
    auditAfter: {
      steps: r.steps.map((s) => ({ stepNo: s.stepNo, role: s.role, assignedToId: s.assignedToId, onBehalfOfId: s.onBehalfOfId, ruleIds: s.ruleIds })),
      releasers: release.releaserIds,
    },
  });
  return { steps: r.steps, release };
}

export interface DecideInput {
  organizationId: string;
  invoiceId: string;
  decision: "approve" | "reject";
  comment: string | null;
  ifMatch: number | null;
}

export async function decide(tx: Tx, actor: WorkflowActor, input: DecideInput) {
  const { organizationId, invoiceId } = input;
  const row = await loadInvoice(tx, organizationId, invoiceId);
  if (input.ifMatch !== null && input.ifMatch !== row.version) {
    throw new AppError(409, "VERSION_CONFLICT", `Invoice ${invoiceId} changed since you opened it. Reload and try again.`);
  }
  if (row.status !== "pending_approval") {
    throw new AppError(409, "INVALID_STATE", `Invoice ${invoiceId} is ${row.status}; nothing is waiting for a decision.`);
  }
  const step = row.approvalSteps.find((s) => s.decision === "pending") ?? null;
  const me = actor.matrix.userId;

  // A delegate acts for an assignee who is now on leave (the step may predate the leave).
  let onBehalfOfId = step?.onBehalfOfId ?? null;
  let record: StepRecord | null = step
    ? { assignedToId: step.assignedToId, onBehalfOfId: step.onBehalfOfId, decision: "pending", decidedById: null }
    : null;
  if (step && step.assignedToId !== me) {
    const assignee = await tx.user.findFirst({ where: { organizationId, id: step.assignedToId } });
    if (assignee?.status === "on_leave" && assignee.delegateId === me) {
      onBehalfOfId = step.assignedToId;
      record = { ...record!, assignedToId: me };
    }
  }
  enforce(canDecideStep(actor.matrix, record, row.requesterId));
  // The person a delegate acts for cannot have requested it either.
  if (onBehalfOfId && row.requesterId === onBehalfOfId) {
    throw new AppError(403, "SELF_APPROVAL", "The person you act for requested this invoice; it goes to their manager.");
  }
  const comment = input.comment?.trim() || null;
  if (input.decision === "reject" && !comment) throw new AppError(422, "REASON_REQUIRED", "Say why you reject it.");

  await tx.approvalStep.update({
    where: { organizationId_id: { organizationId, id: step!.id } },
    data: { decision: input.decision === "approve" ? "approved" : "rejected", decidedById: me, decidedAt: new Date(), comment, onBehalfOfId },
  });
  const auditActor = { ...actor.audit, ...(onBehalfOfId ? { onBehalfOfId } : {}) };
  const stepInfo = { stepNo: step!.stepNo, role: step!.role, decidedById: me, onBehalfOfId };

  if (input.decision === "reject") {
    await transitionInvoice(tx, {
      organizationId,
      invoiceId,
      to: "rejected",
      actor: auditActor,
      action: "invoice.reject",
      expectedVersion: row.version,
      reason: comment,
      data: { assignedToId: null },
      auditAfter: { step: stepInfo },
    });
    return { status: "rejected" as const, next: null };
  }

  const next = row.approvalSteps.find((s) => s.decision === "pending" && s.id !== step!.id) ?? null;
  if (next) {
    await bumpInvoiceVersion(tx, organizationId, invoiceId, row.version, { assignedToId: next.assignedToId });
    await logAction(tx, {
      organizationId,
      actor: auditActor,
      action: "invoice.approve",
      entityType: "invoice",
      entityId: invoiceId,
      before: { step: step!.stepNo, decision: "pending" },
      after: { step: stepInfo, next: { stepNo: next.stepNo, assignedToId: next.assignedToId } },
      reason: comment,
    });
    return { status: "pending_approval" as const, next: next.assignedToId };
  }
  await transitionInvoice(tx, {
    organizationId,
    invoiceId,
    to: "approved",
    actor: auditActor,
    action: "invoice.approve",
    expectedVersion: row.version,
    reason: comment,
    data: { assignedToId: null },
    auditAfter: { step: stepInfo },
  });
  return { status: "approved" as const, next: null };
}

/** Clerk reopens a rejected invoice for review (BUILD_PLAN: rejection ends the chain; reopen to needs_review). */
export async function reopen(tx: Tx, actor: WorkflowActor, organizationId: string, invoiceId: string, reason: string | null) {
  if (!reason?.trim()) throw new AppError(422, "REASON_REQUIRED", "Say why it is reopened.");
  return transitionInvoice(tx, { organizationId, invoiceId, to: "needs_review", actor: actor.audit, action: "invoice.reopen", reason });
}

export async function setDelegation(
  tx: Tx,
  actor: WorkflowActor,
  input: { delegateId: string | null; onLeave: boolean },
) {
  const { user } = actor;
  let delegateRowId: string | null = null;
  if (input.delegateId) {
    const d = await tx.user.findFirst({
      where: { organizationId: user.organizationId, OR: [{ externalId: input.delegateId }, { id: input.delegateId }] },
    });
    if (!d || d.id === user.id || d.status !== "active" || !["approver", "finance_manager", "controller_admin"].includes(d.role)) {
      throw new AppError(422, "DELEGATE_INVALID", "The delegate must be another active approver, finance manager or controller.");
    }
    delegateRowId = d.id;
  }
  if (input.onLeave && !delegateRowId) {
    throw new AppError(422, "DELEGATE_INVALID", "Name a delegate before going on leave.");
  }
  const before = { delegateId: user.delegateId, status: user.status };
  const status = input.onLeave ? "on_leave" : user.status === "on_leave" ? "active" : user.status;
  const updated = await tx.user.update({ where: { id: user.id }, data: { delegateId: delegateRowId, status } });
  await logAction(tx, {
    organizationId: user.organizationId,
    actor: actor.audit,
    action: "user.delegation",
    entityType: "user",
    entityId: user.id,
    before,
    after: { delegateId: delegateRowId, status },
  });
  return updated;
}
