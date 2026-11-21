/**
 * Payments (BUILD_PLAN Payments):
 *
 * - prepare (AP clerk): an approved invoice with nothing blocking becomes a scheduled payment, dated
 *   the due date by default, by the vendor's preferred method. Invoice → scheduled.
 * - release (finance manager up to the P09 limit, controller any amount, never an approver of the
 *   invoice): checked again for every blocker; stores the releaser and a snapshot of the bank details.
 *   Invoice → released.
 * - simulateBankRun: released → settled (EFT, card) or sent (cheque); a later run clears sent cheques.
 *   EFT writes a statement line, card writes an AP virtual-card transaction, a cheque writes its
 *   "CHEQUE NNNN CLEARED" line when it clears. An EFT to an account that is not 8 or 9 digits fails;
 *   the invoice goes back to approved. Invoice → paid when settled payments cover its total.
 *
 * Refused at prepare and again at release: an open hold or fraud flag (OPEN_HOLD), vendor not active
 * (VENDOR_NOT_PAYABLE), a pending bank change (BANK_CHANGE_UNVERIFIED), EFT with no bank details
 * (NO_BANK_DETAILS); at prepare also not approved (NOT_APPROVED) and a live payment (ALREADY_SCHEDULED).
 */
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor as AuditActor, logAction } from "@/lib/audit";
import { canRelease, type StepRecord } from "@/lib/auth/matrix";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http";
import { transitionInvoice } from "@/lib/invoices/transition";
import { merchantDescriptor } from "@/lib/rules/keys";
import { releaseEligibility } from "@/lib/rules/routing/route";
import { today } from "@/lib/today";
import { enforce, type WorkflowActor } from "./guard";
import { loadLiveRefs } from "./refs";

type Tx = Prisma.TransactionClient;

const LIVE = ["scheduled", "released", "sent", "settled"];

export interface Blocker {
  code: "NOT_APPROVED" | "OPEN_HOLD" | "VENDOR_NOT_PAYABLE" | "BANK_CHANGE_UNVERIFIED" | "NO_BANK_DETAILS" | "ALREADY_SCHEDULED";
  message: string;
}

const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Everything that stops this invoice being paid now. `stage` decides which checks apply. */
export async function paymentBlockers(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
  stage: "prepare" | "release",
  ignorePaymentId?: string,
): Promise<Blocker[]> {
  const inv = await tx.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    include: { flags: { where: { status: "open" } }, payments: true },
  });
  if (!inv) throw new AppError(404, "INVOICE_NOT_FOUND", `No invoice ${invoiceId}.`);
  const out: Blocker[] = [];
  if (stage === "prepare" && inv.status !== "approved") {
    out.push({ code: "NOT_APPROVED", message: `Invoice ${invoiceId} is ${inv.status}; only an approved invoice is paid.` });
  }
  const holds = inv.flags.filter((f) => f.effect === "hold" || f.klass === "fraud");
  if (holds.length) {
    out.push({ code: "OPEN_HOLD", message: `Open flags hold this payment: ${holds.map((f) => f.code).join(", ")}.` });
  }
  if (!inv.vendorId) {
    out.push({ code: "VENDOR_NOT_PAYABLE", message: "The invoice has no vendor." });
    return out;
  }
  const vendor = await tx.vendor.findFirstOrThrow({ where: { organizationId, id: inv.vendorId } });
  if (vendor.status !== "active") {
    out.push({ code: "VENDOR_NOT_PAYABLE", message: `${vendor.legalName} is ${vendor.status.replace("_", " ")}; only an active vendor is paid.` });
  }
  const pending = await tx.bankChangeRequest.findFirst({ where: { organizationId, vendorId: vendor.id, status: "pending" } });
  if (pending) {
    out.push({
      code: "BANK_CHANGE_UNVERIFIED",
      message: `${vendor.legalName}'s bank change ${pending.id} (account ending ${pending.oldLast4} → ${pending.newLast4}) has not been verified by a callback.`,
    });
  }
  if (vendor.preferredPaymentMethod === "EFT") {
    const acct = await tx.vendorBankAccount.findFirst({ where: { organizationId, vendorId: vendor.id, validTo: null } });
    if (!acct?.account) out.push({ code: "NO_BANK_DETAILS", message: `${vendor.legalName} is paid by EFT but has no bank account on file.` });
  }
  if (stage === "prepare") {
    const live = inv.payments.filter((p) => LIVE.includes(p.status) && p.id !== ignorePaymentId);
    if (live.length) out.push({ code: "ALREADY_SCHEDULED", message: `Invoice ${invoiceId} already has payment ${live[0].id} (${live[0].status}).` });
  }
  return out;
}

function refuse(blockers: Blocker[]): never {
  const b = blockers[0];
  const status = b.code === "ALREADY_SCHEDULED" ? 409 : 422;
  throw new AppError(status, b.code, blockers.map((x) => x.message).join(" "));
}

async function nextId(tx: Tx, organizationId: string, table: "payment" | "statement" | "card"): Promise<{ id: string; n: number }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ids:${table}:${organizationId}`}))`;
  const [prefix, rows] =
    table === "payment"
      ? ["PAY-", await tx.payment.findMany({ where: { organizationId }, select: { id: true } })]
      : table === "statement"
        ? ["BK-", await tx.bankStatementLine.findMany({ where: { organizationId }, select: { id: true } })]
        : ["CT-", await tx.cardTransaction.findMany({ where: { organizationId }, select: { id: true } })];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(prefix.length)) || 0), 0);
  return { id: `${prefix}${String(max + 1).padStart(5, "0")}`, n: max + 1 };
}

export async function preparePayment(
  tx: Tx,
  actor: WorkflowActor,
  organizationId: string,
  invoiceId: string,
  scheduledDate?: string | null,
) {
  const blockers = await paymentBlockers(tx, organizationId, invoiceId, "prepare");
  if (blockers.length) refuse(blockers);
  const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId } });
  const vendor = await tx.vendor.findFirstOrThrow({ where: { organizationId, id: inv.vendorId! } });
  if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new AppError(422, "BAD_FIELD", "scheduledDate: YYYY-MM-DD.");
  const when = scheduledDate ? dateOf(scheduledDate) : (inv.dueDate ?? dateOf(today()));
  const { id } = await nextId(tx, organizationId, "payment");
  const amount = new Decimal(inv.total!.toString());
  const fx = new Decimal(inv.fxRateToCad?.toString() ?? "1");
  const payment = await tx.payment.create({
    data: {
      organizationId,
      id,
      invoiceId,
      vendorId: vendor.id,
      method: vendor.preferredPaymentMethod,
      scheduledDate: when,
      currency: inv.currency ?? "CAD",
      amount: amount.toFixed(2),
      fxRateToCad: fx.toFixed(4),
      amountCad: (inv.totalCad ? new Decimal(inv.totalCad.toString()) : amount.mul(fx)).toFixed(2),
      status: "scheduled",
      preparedById: actor.user.id,
    },
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "payment.prepare",
    entityType: "payment",
    entityId: id,
    invoiceId,
    vendorId: vendor.id,
    after: payment,
  });
  await transitionInvoice(tx, { organizationId, invoiceId, to: "scheduled", actor: actor.audit, action: "invoice.scheduled", auditAfter: { paymentId: id } });
  return payment;
}

/** Who may release this payment now, and why nobody can when that is the case (for the dashboard). */
export async function releasersFor(tx: Tx, organizationId: string, invoiceId: string, amountCad: number) {
  const refs = await loadLiveRefs(tx, organizationId);
  const steps = await tx.approvalStep.findMany({ where: { organizationId, invoiceId, decision: "approved" } });
  const asPeople = steps.map((s) => ({ assignedToId: refs.people.toPerson(s.decidedById ?? s.assignedToId), onBehalfOfId: refs.people.toPerson(s.onBehalfOfId) }));
  return { ...releaseEligibility(amountCad, asPeople, refs.policyRules, refs), refs };
}

export async function releasePayment(tx: Tx, actor: WorkflowActor, organizationId: string, paymentId: string) {
  const payment = await tx.payment.findFirst({ where: { organizationId, id: paymentId } });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", `No payment ${paymentId}.`);
  if (payment.status !== "scheduled") throw new AppError(409, "INVALID_STATE", `Payment ${paymentId} is ${payment.status}; only a scheduled payment is released.`);
  const steps = await tx.approvalStep.findMany({ where: { organizationId, invoiceId: payment.invoiceId } });
  const records: StepRecord[] = steps.map((s) => ({
    assignedToId: s.assignedToId,
    onBehalfOfId: s.onBehalfOfId,
    decision: s.decision as StepRecord["decision"],
    decidedById: s.decidedById,
  }));
  const refs = await loadLiveRefs(tx, organizationId);
  enforce(canRelease(actor.matrix, records, new Decimal(payment.amountCad.toString()), refs.policyRules));
  const blockers = await paymentBlockers(tx, organizationId, payment.invoiceId, "release");
  if (blockers.length) refuse(blockers);

  const acct = await tx.vendorBankAccount.findFirst({ where: { organizationId, vendorId: payment.vendorId, validTo: null } });
  const bankSnapshot =
    payment.method === "EFT" && acct
      ? { accountId: acct.id, institution: acct.institution, transit: acct.transit, account: acct.account, last4: acct.last4, validFrom: acct.validFrom }
      : null;
  const updated = await tx.payment.update({
    where: { organizationId_id: { organizationId, id: paymentId } },
    data: { status: "released", releasedById: actor.user.id, releasedAt: new Date(), bankSnapshot: bankSnapshot ? (JSON.parse(JSON.stringify(bankSnapshot)) as Prisma.InputJsonValue) : undefined },
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "payment.release",
    entityType: "payment",
    entityId: paymentId,
    invoiceId: payment.invoiceId,
    vendorId: payment.vendorId,
    before: { status: "scheduled" },
    after: { status: "released", bankSnapshot },
  });
  // Imported scheduled payments may sit on an invoice already marked scheduled; move it to released.
  const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId, id: payment.invoiceId }, select: { status: true } });
  if (inv.status === "scheduled") {
    await transitionInvoice(tx, { organizationId, invoiceId: payment.invoiceId, to: "released", actor: actor.audit, action: "invoice.released", auditAfter: { paymentId } });
  }
  return updated;
}

export interface BankRunResult {
  settled: string[];
  sent: string[];
  cleared: string[];
  failed: Array<{ paymentId: string; reason: string }>;
}

/** Released → sent/settled; sent cheques clear. One transaction for the whole run. */
export async function simulateBankRun(tx: Tx, actor: { audit: AuditActor }, organizationId: string): Promise<BankRunResult> {
  const out: BankRunResult = { settled: [], sent: [], cleared: [], failed: [] };
  const on = dateOf(today());
  // Cheques mailed by an earlier run clear now.
  const mailed = await tx.payment.findMany({ where: { organizationId, status: "sent", method: "CHEQUE", source: "app" }, orderBy: { id: "asc" } });
  for (const p of mailed) {
    const line = await nextId(tx, organizationId, "statement");
    await tx.bankStatementLine.create({
      data: { organizationId, id: line.id, postedDate: on, description: `CHEQUE ${p.reference!.slice(-4)} CLEARED`, debit: p.amount, source: "simulated" },
    });
    await settle(tx, actor.audit, organizationId, p.id, p.invoiceId, { status: "settled" }, "payment.cleared");
    out.cleared.push(p.id);
  }

  const released = await tx.payment.findMany({ where: { organizationId, status: "released" }, include: { vendor: true }, orderBy: { id: "asc" } });
  for (const p of released) {
    const n = Number(p.id.replace(/\D/g, "")) || 0;
    const digits = String(config.payments.referenceBase + n).padStart(config.payments.referenceDigits, "0").slice(-config.payments.referenceDigits);
    if (p.method === "EFT") {
      const account = (p.bankSnapshot as { account?: string } | null)?.account ?? "";
      if (!config.payments.eftAccountDigits.includes(account.replace(/\D/g, "").length) || /\D/.test(account)) {
        const reason = `The bank rejected the EFT: account "${account || "none"}" is not ${config.payments.eftAccountDigits.join(" or ")} digits.`;
        await tx.payment.update({ where: { organizationId_id: { organizationId, id: p.id } }, data: { status: "failed", failureReason: reason } });
        await logAction(tx, { organizationId, actor: actor.audit, action: "payment.failed", entityType: "payment", entityId: p.id, invoiceId: p.invoiceId, vendorId: p.vendorId, before: { status: "released" }, after: { status: "failed" }, reason });
        const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId, id: p.invoiceId }, select: { status: true } });
        if (inv.status === "released") {
          await transitionInvoice(tx, { organizationId, invoiceId: p.invoiceId, to: "approved", actor: actor.audit, action: "invoice.payment_failed", reason });
        }
        out.failed.push({ paymentId: p.id, reason });
        continue;
      }
      const reference = `${config.payments.referencePrefix.EFT}${digits}`;
      const line = await nextId(tx, organizationId, "statement");
      const name = p.vendor.legalName.toUpperCase().slice(0, config.payments.statementNameMaxLen);
      await tx.bankStatementLine.create({
        data: { organizationId, id: line.id, postedDate: on, description: `EFT PMT ${name} ${reference.slice(-6)}`, debit: p.amount, source: "simulated" },
      });
      await settle(tx, actor.audit, organizationId, p.id, p.invoiceId, { status: "settled", reference, paidDate: on });
      out.settled.push(p.id);
    } else if (p.method === "CARD") {
      const reference = `${config.payments.referencePrefix.CARD}${digits}`;
      const ct = await nextId(tx, organizationId, "card");
      await tx.cardTransaction.create({
        data: {
          organizationId,
          id: ct.id,
          cardId: `VC-${p.invoiceId}`,
          cardholderUserId: p.releasedById ?? p.preparedById,
          postedDate: on,
          merchantDescriptor: merchantDescriptor(p.vendor.legalName, config.duplicates.cardMerchantMaxLen),
          mcc: "0000",
          amount: p.amount,
          currency: p.currency,
          amountCad: p.amountCad,
          source: "ap_virtual_card",
          receiptAttached: true,
          memo: `AP payment ${p.invoiceId}`,
          origin: "simulated",
        },
      });
      await settle(tx, actor.audit, organizationId, p.id, p.invoiceId, { status: "settled", reference, paidDate: on });
      out.settled.push(p.id);
    } else {
      const reference = `${config.payments.referencePrefix.CHEQUE}${digits}`;
      await tx.payment.update({ where: { organizationId_id: { organizationId, id: p.id } }, data: { status: "sent", reference, paidDate: on } });
      await logAction(tx, { organizationId, actor: actor.audit, action: "payment.sent", entityType: "payment", entityId: p.id, invoiceId: p.invoiceId, vendorId: p.vendorId, before: { status: "released" }, after: { status: "sent", reference } });
      out.sent.push(p.id);
    }
  }
  await logAction(tx, { organizationId, actor: actor.audit, action: "payment.bank_run", entityType: "bank_run", entityId: on.toISOString().slice(0, 10), after: out });
  return out;
}

async function settle(
  tx: Tx,
  actor: AuditActor,
  organizationId: string,
  paymentId: string,
  invoiceId: string,
  data: { status: "settled"; reference?: string; paidDate?: Date },
  action = "payment.settled",
) {
  const before = await tx.payment.findFirstOrThrow({ where: { organizationId, id: paymentId }, select: { status: true } });
  await tx.payment.update({ where: { organizationId_id: { organizationId, id: paymentId } }, data });
  await logAction(tx, { organizationId, actor, action, entityType: "payment", entityId: paymentId, invoiceId, before, after: data });
  const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId }, include: { payments: true } });
  const settled = inv.payments.filter((p) => p.status === "settled").reduce((s, p) => s.plus(p.amount.toString()), new Decimal(0));
  if (inv.total && settled.gte(inv.total.toString()) && inv.status === "released") {
    await transitionInvoice(tx, { organizationId, invoiceId, to: "paid", actor, action: "invoice.paid", auditAfter: { paymentId } });
  }
}

/**
 * Day-one state (BUILD_PLAN Payments): the history replay's flags on the invoices still unpaid on the
 * as-of date (scheduled or approved), stored as Flag rows so the dashboard and release see them
 * (AP-00407 DUP_EXACT with AP-00394; AP-00426 BANK_CHANGE_UNVERIFIED). Idempotent.
 */
export async function flagOpenHistory(tx: Tx, organizationId: string, replay: Array<{ invoiceId: string; status: string; flags: Array<{ code: string; klass: string; effect: string; message: string; evidence: unknown; related?: unknown }> }>) {
  const open = await tx.invoice.findMany({ where: { organizationId, source: "history", status: { in: ["scheduled", "approved"] } }, select: { id: true, vendorId: true } });
  const vendorOf = new Map(open.map((o) => [o.id, o.vendorId]));
  let created = 0;
  for (const r of replay) {
    if (!vendorOf.has(r.invoiceId)) continue;
    for (const f of r.flags) {
      const exists = await tx.flag.findFirst({ where: { organizationId, invoiceId: r.invoiceId, code: f.code } });
      if (exists) continue;
      const flag = await tx.flag.create({
        data: {
          organizationId,
          invoiceId: r.invoiceId,
          vendorId: vendorOf.get(r.invoiceId),
          code: f.code,
          klass: f.klass,
          effect: f.effect,
          message: f.message,
          evidence: JSON.parse(JSON.stringify(f.evidence ?? [])) as Prisma.InputJsonValue,
          related: f.related ? (JSON.parse(JSON.stringify(f.related)) as Prisma.InputJsonValue) : undefined,
        },
      });
      await logAction(tx, { organizationId, actor: { type: "system" }, action: "flag.raised", entityType: "flag", entityId: flag.id, invoiceId: r.invoiceId, after: { code: f.code, klass: f.klass, effect: f.effect }, reason: "History replay on day one" });
      created++;
    }
  }
  return created;
}
