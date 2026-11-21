/**
 * Audit trail reads (BUILD_PLAN Audit trail): the audit pack for one payment, the CSV export, and the
 * "verify chain" check. All read-only; controller and auditor (matrix `audit.read`).
 *
 * The audit pack, on one screen: the payment, its invoice and document, each approval with delegate
 * information, the coding and the posting, every flag and how it was resolved, the bank details paid
 * to, and every audit event for the invoice and the payment. It works for history payments too: their
 * approvals and payments were imported as ApprovalStep rows and `history` audit events.
 */
import Decimal from "decimal.js";
import type { User } from "@/generated/prisma/client";
import { type AuditFilter, listActions } from "@/lib/audit";
import { verifyChain } from "@/lib/audit/chain";
import { authorize } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { enforce } from "./guard";

/** GST/HST and QST are recoverable (1160, 1165); BC PST is not, so it is added to the goods lines' cost. */
const ACCOUNT = { gstHst: "1160", qst: "1165", payable: "2100" } as const;

export function requireAuditRead(user: User | null) {
  if (!user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
  enforce(authorize({ userId: user.id, role: user.role, departmentId: user.departmentId ?? "" }, "audit.read"));
}

export interface PostingLine {
  account: string;
  name: string;
  debit: string | null;
  credit: string | null;
  note: string;
}

/**
 * The journal for an invoice: each line's expense account (plus its share of BC PST when it is goods),
 * GST/HST to 1160, QST to 1165, the total to 2100 accounts payable.
 */
export function posting(
  inv: { total: Decimal | null; currency: string | null },
  lines: Array<{ lineNo: number; account: string | null; amount: Decimal | null; lineType: string | null }>,
  taxes: Array<{ taxCode: string | null; amount: Decimal }>,
  names: Record<string, string>,
): PostingLine[] {
  const out: PostingLine[] = [];
  const sum = (codes: string[]) => taxes.filter((t) => t.taxCode && codes.includes(t.taxCode)).reduce((s, t) => s.plus(t.amount), new Decimal(0));
  const pst = sum(["PST7_BC"]);
  const goods = lines.filter((l) => l.lineType === "goods" && l.amount);
  const goodsTotal = goods.reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  let pstLeft = pst;
  for (const l of lines) {
    if (!l.amount) continue;
    let share = new Decimal(0);
    if (!pst.isZero() && l.lineType === "goods" && !goodsTotal.isZero()) {
      const isLast = goods[goods.length - 1].lineNo === l.lineNo;
      share = isLast ? pstLeft : pst.mul(l.amount).div(goodsTotal).toDecimalPlaces(2);
      pstLeft = pstLeft.minus(share);
    }
    const acct = l.account ?? "????";
    out.push({
      account: acct,
      name: names[acct] ?? "",
      debit: l.amount.plus(share).toFixed(2),
      credit: null,
      note: `Line ${l.lineNo}${share.isZero() ? "" : `, includes ${share.toFixed(2)} BC PST (not recoverable)`}`,
    });
  }
  const gst = sum(["GST5", "HST13"]);
  if (!gst.isZero()) out.push({ account: ACCOUNT.gstHst, name: names[ACCOUNT.gstHst] ?? "GST/HST receivable", debit: gst.toFixed(2), credit: null, note: "GST/HST, recoverable" });
  const qst = sum(["QST9975"]);
  if (!qst.isZero()) out.push({ account: ACCOUNT.qst, name: names[ACCOUNT.qst] ?? "QST receivable", debit: qst.toFixed(2), credit: null, note: "QST, recoverable" });
  if (inv.total) out.push({ account: ACCOUNT.payable, name: names[ACCOUNT.payable] ?? "Accounts payable", debit: null, credit: inv.total.toFixed(2), note: `Total owed${inv.currency && inv.currency !== "CAD" ? ` (${inv.currency})` : ""}` });
  return out;
}

const D = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : new Decimal(v.toString()));

export async function auditPack(user: User | null, paymentId: string) {
  requireAuditRead(user);
  const organizationId = user!.organizationId;
  const prisma = db();
  const payment = await prisma.payment.findFirst({ where: { organizationId, id: paymentId }, include: { vendor: true } });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", `No payment ${paymentId}.`);
  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { organizationId, id: payment.invoiceId },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      taxes: true,
      flags: { orderBy: { createdAt: "asc" } },
      approvalSteps: { orderBy: { stepNo: "asc" } },
      document: { select: { id: true, fileName: true, mimeType: true } },
    },
  });
  const [users, accounts, invoiceEvents, paymentEvents] = await Promise.all([
    prisma.user.findMany({ where: { organizationId }, select: { id: true, externalId: true, fullName: true, title: true } }),
    prisma.glAccount.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    listActions(organizationId, { invoiceId: invoice.id, limit: 1000 }),
    listActions(organizationId, { entityType: "payment", entityId: payment.id, limit: 1000 }),
  ]);
  const person = (rowId: string | null) => {
    if (!rowId) return null;
    const u = users.find((x) => x.id === rowId);
    return u ? { id: u.externalId ?? u.id, name: u.fullName, title: u.title } : { id: rowId, name: rowId, title: null };
  };
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  // Bank details paid to: the snapshot taken at release, else the account live on the paid (or scheduled) date.
  let bank: Record<string, unknown> | null = (payment.bankSnapshot as Record<string, unknown> | null) ?? null;
  let bankSource = bank ? "snapshot taken at release" : null;
  if (!bank && payment.method === "EFT") {
    const on = payment.paidDate ?? payment.scheduledDate;
    const acct = await prisma.vendorBankAccount.findFirst({
      where: { organizationId, vendorId: payment.vendorId, validFrom: { lte: on }, OR: [{ validTo: null }, { validTo: { gt: on } }] },
      orderBy: { validFrom: "desc" },
    });
    if (acct) {
      bank = { institution: acct.institution, transit: acct.transit, account: acct.account, last4: acct.last4, validFrom: acct.validFrom, validTo: acct.validTo };
      bankSource = `account on file on ${on.toISOString().slice(0, 10)} (history payments have no snapshot)`;
    }
  }

  const events = [...invoiceEvents, ...paymentEvents.filter((p) => !invoiceEvents.some((i) => i.seq === p.seq))]
    .sort((a, b) => Number(a.seq - b.seq))
    .map((e) => ({ ...e, seq: e.seq.toString(), actor: person(e.actorId), onBehalfOf: person(e.onBehalfOfId) }));

  return {
    payment: {
      ...payment,
      vendorName: payment.vendor.legalName,
      preparedBy: person(payment.preparedById),
      releasedBy: person(payment.releasedById),
    },
    invoice: {
      id: invoice.id,
      source: invoice.source,
      status: invoice.status,
      vendorId: invoice.vendorId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      total: invoice.total,
      totalCad: invoice.totalCad,
      departmentId: invoice.departmentId,
      requester: person(invoice.requesterId),
      document: invoice.document,
    },
    approvals: invoice.approvalSteps.map((s) => ({
      stepNo: s.stepNo,
      role: s.role,
      assignedTo: person(s.assignedToId),
      onBehalfOf: person(s.onBehalfOfId),
      decision: s.decision,
      decidedBy: person(s.decidedById),
      decidedAt: s.decidedAt,
      comment: s.comment,
      why: s.why,
    })),
    coding: invoice.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      amount: l.amount,
      glSuggested: l.glSuggested,
      glFinal: l.glFinal,
      overridden: !!l.glFinal && !!l.glSuggested && l.glFinal !== l.glSuggested,
      department: l.departmentFinal ?? l.departmentSuggested,
      lineType: l.lineType,
      reason: l.reason,
    })),
    posting: posting(
      { total: D(invoice.total), currency: invoice.currency },
      invoice.lines.map((l) => ({ lineNo: l.lineNo, account: l.glFinal ?? l.glSuggested, amount: D(l.amount), lineType: l.lineType })),
      invoice.taxes.map((t) => ({ taxCode: t.taxCode, amount: new Decimal(t.amount.toString()) })),
      names,
    ),
    flags: invoice.flags.map((f) => ({ ...f, resolvedBy: person(f.resolvedById) })),
    bank,
    bankSource,
    events,
  };
}

// ---------- CSV ----------

const CSV_COLUMNS = ["seq", "at", "source", "actorType", "actorId", "actorRole", "onBehalfOfId", "action", "entityType", "entityId", "invoiceId", "paymentId", "vendorId", "reason", "before", "after", "prevHash", "hash"] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The filtered log as CSV, oldest first (at most `limit` rows, default every row). */
export async function auditCsv(user: User | null, filter: AuditFilter): Promise<string> {
  requireAuditRead(user);
  const rows = await listActions(user!.organizationId, { ...filter, limit: filter.limit ?? 100_000 });
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of [...rows].reverse()) lines.push(CSV_COLUMNS.map((c) => cell((r as Record<string, unknown>)[c])).join(","));
  return `${lines.join("\n")}\n`;
}

// ---------- Verify chain ----------

/** Recomputes every hash in seq order and reports the first row that does not match. */
export async function verifyAuditChain(user: User | null) {
  requireAuditRead(user);
  const rows = await db().auditEvent.findMany({ where: { organizationId: user!.organizationId }, orderBy: { seq: "asc" } });
  const result = verifyChain(rows.map((r) => ({ ...r, source: r.source as "app" | "history" })));
  if (result.ok) return { ok: true as const, count: result.count, lastHash: result.lastHash };
  const bad = rows[result.index];
  return {
    ok: false as const,
    count: result.count,
    firstBad: { seq: bad.seq.toString(), at: bad.at, action: bad.action, entityType: bad.entityType, entityId: bad.entityId },
    reason: result.reason,
  };
}
