/**
 * The one place an invoice's status changes (BUILD_PLAN "Decisions": invoice states; AGENTS.md:
 * "Invoice status changes go through the single guarded transition function").
 *
 * - The move must be an edge of STATUS_MACHINE, else 409 INVALID_STATE.
 * - Optimistic lock: the row is updated only where its status and version are still the ones read
 *   (or the caller's `expectedVersion`), else 409 VERSION_CONFLICT. Every move bumps `version`.
 * - `on_hold` remembers where it came from in `heldFrom`; leaving a hold returns there.
 * - The audit row is written in the same transaction, with before and after.
 *
 * `data` lets the caller write other columns in the same guarded update (e.g. run.ts storing the
 * extraction); it may not touch status, version or heldFrom.
 */
import type { Prisma } from "@/generated/prisma/client";
import { type Actor, logAction } from "@/lib/audit";
import { AppError } from "@/lib/http";
import type { InvoiceStatus } from "@/lib/types";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "received",
  "extracted",
  "needs_review",
  "coded",
  "pending_approval",
  "approved",
  "scheduled",
  "released",
  "paid",
  "rejected",
  "on_hold",
  "duplicate",
  "void",
];

/**
 * Allowed moves. `on_hold` is reachable from every working state and leaves only to `heldFrom`
 * (or to duplicate/void); that is checked in code, not listed here.
 */
export const STATUS_MACHINE: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  received: ["extracted", "needs_review", "coded", "duplicate", "void"],
  extracted: ["needs_review", "coded", "duplicate", "void"],
  // needs_review → needs_review lets a re-run of the checks record itself without changing state.
  needs_review: ["needs_review", "coded", "duplicate", "void"],
  coded: ["needs_review", "coded", "pending_approval", "duplicate", "void"],
  // pending_approval → needs_review: a step could not be resolved, or the clerk withdrew it.
  pending_approval: ["approved", "rejected", "needs_review", "void"],
  approved: ["scheduled", "needs_review", "void"],
  // scheduled → approved: the payment was cancelled before release.
  scheduled: ["released", "approved"],
  // released → approved: the payment failed at the bank and must be prepared again.
  released: ["paid", "approved"],
  paid: [],
  rejected: ["needs_review", "void"],
  on_hold: [],
  duplicate: ["needs_review", "void"],
  void: [],
};

/** States a hold may be placed on: anything still in flight. */
const HOLDABLE: ReadonlySet<InvoiceStatus> = new Set([
  "received",
  "extracted",
  "needs_review",
  "coded",
  "pending_approval",
  "approved",
  "scheduled",
]);

export function isInvoiceStatus(s: string): s is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(s);
}

/** Pure: may an invoice in `from` (held from `heldFrom`) move to `to`? */
export function canTransition(from: string, to: InvoiceStatus, heldFrom: string | null = null): boolean {
  if (!isInvoiceStatus(from)) return false;
  if (to === "on_hold") return HOLDABLE.has(from);
  if (from === "on_hold") return to === heldFrom || to === "duplicate" || to === "void";
  return STATUS_MACHINE[from].includes(to);
}

export interface TransitionInput {
  organizationId: string;
  invoiceId: string;
  to: InvoiceStatus;
  actor: Actor;
  /** The version the caller read (If-Match). Omit to lock on the version read here. */
  expectedVersion?: number;
  /** Audit action name; default "invoice.status". */
  action?: string;
  reason?: string | null;
  /** Other columns to write in the same guarded update. */
  data?: Omit<Prisma.InvoiceUncheckedUpdateManyInput, "status" | "version" | "heldFrom">;
  /** Extra fields for the audit row's `after`. */
  auditAfter?: Record<string, unknown>;
}

export interface TransitionResult {
  invoiceId: string;
  from: string;
  to: InvoiceStatus;
  version: number;
}

export async function transitionInvoice(tx: Prisma.TransactionClient, input: TransitionInput): Promise<TransitionResult> {
  const { organizationId, invoiceId, to } = input;
  const current = await tx.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    select: { status: true, version: true, heldFrom: true },
  });
  if (!current) throw new AppError(404, "INVOICE_NOT_FOUND", `No invoice ${invoiceId}.`);
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      `Invoice ${invoiceId} changed since you opened it (version ${current.version}, you had ${input.expectedVersion}). Reload and try again.`,
    );
  }
  if (!canTransition(current.status, to, current.heldFrom)) {
    throw new AppError(409, "INVALID_STATE", `Invoice ${invoiceId} is ${current.status}; it cannot move to ${to}.`);
  }
  const data = input.data ?? {};
  if ("status" in data || "version" in data || "heldFrom" in data) {
    throw new Error("transitionInvoice: data may not set status, version or heldFrom.");
  }
  const heldFrom = to === "on_hold" ? current.status : current.status === "on_hold" ? null : current.heldFrom;
  const { count } = await tx.invoice.updateMany({
    where: { organizationId, id: invoiceId, status: current.status, version: current.version },
    data: { ...data, status: to, heldFrom, version: { increment: 1 } },
  });
  if (count !== 1) {
    throw new AppError(409, "VERSION_CONFLICT", `Invoice ${invoiceId} was changed by someone else. Reload and try again.`);
  }
  await logAction(tx, {
    organizationId,
    actor: input.actor,
    action: input.action ?? "invoice.status",
    entityType: "invoice",
    entityId: invoiceId,
    before: { status: current.status, version: current.version, heldFrom: current.heldFrom },
    after: { status: to, version: current.version + 1, heldFrom, ...(input.auditAfter ?? {}) },
    reason: input.reason ?? null,
  });
  return { invoiceId, from: current.status, to, version: current.version + 1 };
}

/** Bumps the version of an invoice whose status does not change (field or coding edits), with the same lock. */
export async function bumpInvoiceVersion(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
  expectedVersion: number,
  data: Omit<Prisma.InvoiceUncheckedUpdateManyInput, "status" | "version" | "heldFrom"> = {},
): Promise<number> {
  if ("status" in data || "version" in data || "heldFrom" in data) {
    throw new Error("bumpInvoiceVersion: data may not set status, version or heldFrom.");
  }
  const { count } = await tx.invoice.updateMany({
    where: { organizationId, id: invoiceId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (count !== 1) {
    throw new AppError(409, "VERSION_CONFLICT", `Invoice ${invoiceId} changed since you opened it. Reload and try again.`);
  }
  return expectedVersion + 1;
}
