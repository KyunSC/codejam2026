/**
 * Bank reconciliation (BUILD_PLAN Bonus): the statement matched to payments by `reconcile`, the
 * leftovers explained, and "Mark explained" for what needs a person.
 *
 * Read: finance manager, controller, auditor. Mark explained: finance manager, controller (the roles that
 * resolve fraud flags), a note required, audited in the same transaction.
 *
 * An explanation is stored as a Flag row on the statement line (`bankTxnId`) or the payment (`paymentId`),
 * code RECON_EXPLAINED, class data, effect info, status overridden, with the note as its resolution. It never
 * holds anything: payment blockers only look at open flags and confirmed fraud flags.
 */
import type { Prisma, User } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { authorize, checkNotReadOnly, firstFailure } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { enforce, type WorkflowActor, workflowActor } from "./guard";
import { reconcile } from "./reconcile-match";

type Tx = Prisma.TransactionClient;
export const EXPLAINED_CODE = "RECON_EXPLAINED";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function requireRead(user: User | null) {
  if (!user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
  const m = workflowActor(user).matrix;
  if (!authorize(m, "audit.read").ok && !authorize(m, "flag.resolve.fraud").ok) {
    throw new AppError(403, "FORBIDDEN", "Reconciliation is for the finance manager, the controller and the auditor.");
  }
  return m;
}

async function compute(prisma: Tx | ReturnType<typeof db>, organizationId: string) {
  const [lines, payments, explained] = await Promise.all([
    prisma.bankStatementLine.findMany({ where: { organizationId }, orderBy: [{ postedDate: "asc" }, { id: "asc" }] }),
    prisma.payment.findMany({ where: { organizationId, method: { in: ["EFT", "CHEQUE"] } }, include: { vendor: { select: { legalName: true } } } }),
    prisma.flag.findMany({ where: { organizationId, code: EXPLAINED_CODE } }),
  ]);
  const result = reconcile(
    lines.map((l) => ({ id: l.id, postedDate: iso(l.postedDate)!, description: l.description, debit: l.debit?.toString() ?? null, credit: l.credit?.toString() ?? null })),
    payments.map((p) => ({
      id: p.id, invoiceId: p.invoiceId, vendorId: p.vendorId, method: p.method, status: p.status, reference: p.reference,
      amount: p.amount.toString(), paidDate: iso(p.paidDate), scheduledDate: iso(p.scheduledDate)!,
    })),
  );
  return { lines, payments, explained, result };
}

export async function reconciliation(user: User | null) {
  requireRead(user);
  const organizationId = user!.organizationId;
  const prisma = db();
  const { lines, payments, explained, result } = await compute(prisma, organizationId);
  const users = await prisma.user.findMany({ where: { organizationId, id: { in: explained.map((f) => f.resolvedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const line = new Map(lines.map((l) => [l.id, l]));
  const pay = new Map(payments.map((p) => [p.id, p]));
  const note = (f: (typeof explained)[number] | undefined) =>
    f ? { note: f.resolutionNote, by: users.find((u) => u.id === f.resolvedById)?.fullName ?? f.resolvedById, at: f.resolvedAt } : null;
  const lineView = (id: string) => {
    const l = line.get(id)!;
    return { id, postedDate: iso(l.postedDate), description: l.description, amount: (l.debit ?? l.credit)?.toString() ?? null, source: l.source };
  };
  const payView = (id: string) => {
    const p = pay.get(id)!;
    return { id, invoiceId: p.invoiceId, vendorId: p.vendorId, vendorName: p.vendor.legalName, method: p.method, status: p.status, reference: p.reference, amount: p.amount.toString(), paidDate: iso(p.paidDate), scheduledDate: iso(p.scheduledDate) };
  };

  const unexplained = result.unexplained.map((u) => ({ ...lineView(u.lineId), reason: u.reason, explained: note(explained.find((f) => f.bankTxnId === u.lineId)) }));
  const paymentsWithoutLine = result.paymentsWithoutLine.map((x) => ({ ...payView(x.paymentId), reason: x.reason, expected: x.expected, explained: note(explained.find((f) => f.paymentId === x.paymentId)) }));
  const matches = result.matches.map((m) => ({ kind: m.kind, note: m.note, line: lineView(m.lineId), payment: payView(m.paymentId) }));

  return {
    summary: {
      lines: lines.length,
      eft: result.matches.filter((m) => m.kind === "eft").length,
      cheques: result.matches.filter((m) => m.kind === "cheque").length,
      withDifference: result.matches.filter((m) => m.note).length,
      monthlyFees: result.fees.filter((f) => f.kind === "monthly").length,
      wireFees: result.fees.filter((f) => f.kind === "wire").length,
      unexplained: unexplained.filter((u) => !u.explained).length,
      explained: unexplained.filter((u) => u.explained).length + paymentsWithoutLine.filter((p) => p.explained).length,
      paymentsWithoutLine: paymentsWithoutLine.length,
      clearedButOutstanding: result.clearedButOutstanding.length,
    },
    unexplained,
    paymentsWithoutLine,
    clearedButOutstanding: result.clearedButOutstanding.map((c) => ({ payment: payView(c.paymentId), line: lineView(c.lineId) })),
    fees: result.fees.map((f) => ({ ...lineView(f.lineId), kind: f.kind, account: f.account })),
    matches,
    canExplain: authorize(workflowActor(user!).matrix, "flag.resolve.fraud").ok,
  };
}

export interface ExplainInput {
  lineId?: string | null;
  paymentId?: string | null;
  note: string | null | undefined;
}

/** "Mark explained": a note on an unexplained statement line or a payment with no line. */
export async function markExplained(tx: Tx, actor: WorkflowActor, organizationId: string, input: ExplainInput) {
  enforce(firstFailure(authorize(actor.matrix, "flag.resolve.fraud"), checkNotReadOnly(actor.matrix)));
  const note = input.note?.trim();
  if (!note) throw new AppError(422, "REASON_REQUIRED", "Say what this is, in a sentence.");
  if (!!input.lineId === !!input.paymentId) throw new AppError(422, "BAD_REQUEST", "Name one statement line or one payment.");

  const { result, explained, lines, payments } = await compute(tx, organizationId);
  const target = input.lineId
    ? result.unexplained.find((u) => u.lineId === input.lineId)
    : result.paymentsWithoutLine.find((p) => p.paymentId === input.paymentId);
  if (!target) {
    const exists = input.lineId ? lines.some((l) => l.id === input.lineId) : payments.some((p) => p.id === input.paymentId);
    if (!exists) throw new AppError(404, "NOT_FOUND", `No ${input.lineId ? `statement line ${input.lineId}` : `payment ${input.paymentId}`}.`);
    throw new AppError(409, "ALREADY_MATCHED", "This item is matched or explained by a rule; nothing to explain.");
  }
  if (explained.some((f) => (input.lineId ? f.bankTxnId === input.lineId : f.paymentId === input.paymentId))) {
    throw new AppError(409, "ALREADY_EXPLAINED", "Someone has already explained this item.");
  }
  const payment = input.paymentId ? payments.find((p) => p.id === input.paymentId) : undefined;
  const flag = await tx.flag.create({
    data: {
      organizationId,
      bankTxnId: input.lineId ?? null,
      paymentId: input.paymentId ?? null,
      vendorId: payment?.vendorId ?? null,
      code: EXPLAINED_CODE,
      klass: "data",
      effect: "info",
      status: "overridden",
      message: `Explained by a person: ${"reason" in target ? target.reason : ""}`.trim(),
      evidence: [],
      resolvedById: actor.user.id,
      resolvedAt: new Date(),
      resolutionNote: note,
    },
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "reconciliation.explain",
    entityType: input.lineId ? "bank_line" : "payment",
    entityId: (input.lineId ?? input.paymentId)!,
    paymentId: input.paymentId ?? undefined,
    vendorId: payment?.vendorId,
    before: { status: "unexplained", reason: target.reason },
    after: { status: "explained", flagId: flag.id },
    reason: note,
  });
  return { flagId: flag.id, explained: true };
}
