/**
 * The history's approvals and payments as `history` audit events, hash-chained in time
 * order (BUILD_PLAN "Audit trail"), so the audit pack works for old payments too.
 *
 * - One event per approval: `invoice.approve` or `invoice.reject`, by the approver, at acted_at.
 * - One event per payment. A released payment is `payment.release` by the releaser, dated the
 *   paid date. A payment not yet released is `payment.schedule` by the clerk who prepared it.
 *   payments.csv records no preparation time, so it is dated the invoice's last approval
 *   (the earliest moment it could have been prepared) and the event's reason says so.
 *   Both kinds carry who prepared and who released in `after`.
 *
 * Ties in time are broken by kind (approvals first) then id, so the chain is reproducible.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { type AuditFields, chainRows, verifyChain } from "../audit/chain";
import type { Dataset } from "../dataset";
import { dateOnly, timestamp } from "./convert";

type Tx = Prisma.TransactionClient | PrismaClient;

interface Sortable {
  sortKind: number;
  sortId: string;
  event: AuditFields;
}

export function historyAuditEvents(
  ds: Pick<Dataset, "approvals" | "payments" | "invoices" | "users">,
): Array<AuditFields & { prevHash: string; hash: string }> {
  const roleOf = new Map(ds.users.map((u) => [u.userId, u.role]));
  const invoiceById = new Map(ds.invoices.map((i) => [i.invoiceId, i]));
  const role = (userId: string) => {
    const r = roleOf.get(userId);
    if (!r) throw new Error(`Audit import: user ${userId} is not in users.csv`);
    return r;
  };
  const lastApproval = new Map<string, Date>();
  for (const a of ds.approvals) {
    const at = timestamp(a.actedAt);
    const prev = lastApproval.get(a.invoiceId);
    if (!prev || at > prev) lastApproval.set(a.invoiceId, at);
  }

  const events: Sortable[] = [];
  for (const a of ds.approvals) {
    const inv = invoiceById.get(a.invoiceId);
    events.push({
      sortKind: 0,
      sortId: a.approvalId,
      event: {
        at: timestamp(a.actedAt),
        actorId: a.approverUserId,
        actorRole: role(a.approverUserId),
        onBehalfOfId: null,
        action: a.action === "approved" ? "invoice.approve" : "invoice.reject",
        entityType: "invoice",
        entityId: a.invoiceId,
        invoiceId: a.invoiceId,
        paymentId: null,
        vendorId: inv?.vendorId ?? null,
        before: { stepNo: a.stepNo, role: a.approverRole, decision: "pending" },
        after: { stepNo: a.stepNo, role: a.approverRole, decision: a.action, approvalId: a.approvalId },
        reason: a.comment,
        source: "history",
      },
    });
  }

  for (const p of ds.payments) {
    const released = p.releasedBy !== null;
    const actor = released ? p.releasedBy! : p.preparedBy;
    const preparedAt = lastApproval.get(p.invoiceId) ?? dateOnly(p.scheduledDate);
    events.push({
      sortKind: 1,
      sortId: p.paymentId,
      event: {
        at: released && p.paidDate ? dateOnly(p.paidDate) : preparedAt,
        actorId: actor,
        actorRole: role(actor),
        onBehalfOfId: null,
        action: released ? "payment.release" : "payment.schedule",
        entityType: "payment",
        entityId: p.paymentId,
        invoiceId: p.invoiceId,
        paymentId: p.paymentId,
        vendorId: p.vendorId,
        before: null,
        after: {
          method: p.method,
          amount: p.amount.toFixed(2),
          currency: p.currency,
          scheduledDate: p.scheduledDate,
          paidDate: p.paidDate,
          reference: p.reference,
          status: p.status,
          preparedById: p.preparedBy,
          releasedById: p.releasedBy,
        },
        reason: released
          ? null
          : "Imported from payments.csv, which records who prepared the payment but not when; dated the invoice's last approval.",
        source: "history",
      },
    });
  }

  events.sort(
    (a, b) =>
      a.event.at.getTime() - b.event.at.getTime() || a.sortKind - b.sortKind || a.sortId.localeCompare(b.sortId),
  );
  return chainRows(events.map((e) => e.event));
}

export async function seedHistoryAudit(tx: Tx, ds: Dataset): Promise<Record<string, number>> {
  const events = historyAuditEvents(ds);
  const data: Prisma.AuditEventCreateManyInput[] = events.map((e) => ({
    ...e,
    before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
    after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
  }));
  const { count } = await tx.auditEvent.createMany({ data });

  // Read the chain back in seq order and verify it, so a reordering on insert fails the seed.
  const stored = await tx.auditEvent.findMany({ orderBy: { seq: "asc" } });
  const result = verifyChain(stored.map((r) => ({ ...r, source: r.source as "app" | "history" })));
  if (!result.ok) throw new Error(`Audit chain does not verify after seeding: ${result.reason}`);
  return { auditEvents: count };
}
