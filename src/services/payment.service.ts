import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { randomInt } from "crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { tx, query, one, nextId, pool, type Db } from "@/lib/db";
import { matches, RELEASE_RANK, REQUIREMENTS, type Policy } from "@/lib/policies";
import { activePolicies } from "./policy.service";
import { assertCan, assertMember, can } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/dates";
import type { User } from "@/lib/types";

type Invoice = { invoice_id: string; organization_id: string; status: string; type: string; vendor_id: string; due_date: string | null; currency: string; total: number; fx_rate_to_cad: number; total_cad: number };

// Prepare (AP clerk): method from the vendor's preferred payment method.
export async function preparePayment(actor: User | null, organizationId: string, invoiceId: string) {
  assertCan(actor, "payment.prepare");
  return tx(async (c) => {
    assertMember(actor, organizationId, { brim: true });
    const inv = await one<Invoice>("SELECT * FROM invoices WHERE invoice_id=$1 AND organization_id=$2 FOR UPDATE", [invoiceId, organizationId], c);
    if (!inv) throw new NotFoundError("No such invoice");
    if (inv.status !== "approved") throw new ConflictError("Only approved invoices can be paid");
    if (inv.type === "credit_note") throw new ConflictError("A credit note is not paid");
    if (await openFraud(invoiceId, c)) throw new ConflictError("A fraud flag on the invoice is open; the finance manager or the controller closes it first.");
    const vendor = (await one<{ preferred_payment_method: "EFT" | "CHEQUE" | "CARD" }>("SELECT preferred_payment_method FROM vendors WHERE vendor_id=$1", [inv.vendor_id], c))!;
    const id = await nextId("PAY", c);
    await query(
      `INSERT INTO payments (payment_id, organization_id, invoice_id, vendor_id, method, scheduled_date, currency, amount, fx_rate_to_cad, amount_cad, status, prepared_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled',$11)`,
      [id, inv.organization_id, invoiceId, inv.vendor_id, vendor.preferred_payment_method ?? "EFT", inv.due_date, inv.currency, inv.total, inv.fx_rate_to_cad, inv.total_cad, actor.user_id],
      c,
    );
    await query("UPDATE invoices SET status='scheduled' WHERE invoice_id=$1", [invoiceId], c);
    await writeAudit(c, { organizationId: inv.organization_id, actor, action: "payment.prepare", entityType: "payment", entityId: id, invoiceId, paymentId: id, vendorId: inv.vendor_id });
    return id;
  });
}

// A released or outstanding payment that will not settle (a lost or uncashed cheque, a transfer the bank returned) is marked
// failed with the reason, by whoever may release payments. The invoice goes back to approved, so a new payment can be prepared.
export async function failPayment(actor: User | null, organizationId: string, paymentId: string, reason: string) {
  assertCan(actor, "payment.release");
  if (!reason?.trim()) throw new ValidationError("Give the reason the payment failed.");
  await tx(async (c) => {
    assertMember(actor, organizationId);
    const pay = await one<{ invoice_id: string; vendor_id: string; status: string }>(
      "SELECT invoice_id, vendor_id, status FROM payments WHERE payment_id=$1 AND organization_id=$2 FOR UPDATE",
      [paymentId, organizationId],
      c,
    );
    if (!pay) throw new NotFoundError("No such payment");
    if (pay.status !== "released" && pay.status !== "outstanding") throw new ConflictError("Only a released or outstanding payment can fail.");
    await query("UPDATE payments SET status='failed', failure_reason=$2 WHERE payment_id=$1", [paymentId, reason.trim()], c);
    await query("UPDATE invoices SET status='approved' WHERE invoice_id=$1", [pay.invoice_id], c);
    await writeAudit(c, {
      organizationId, actor, action: "payment.failed", entityType: "payment", entityId: paymentId, invoiceId: pay.invoice_id, paymentId, vendorId: pay.vendor_id, note: reason.trim(),
    });
  });
}

// An open fraud flag on the invoice holds its payment: it is neither prepared nor released.
async function openFraud(invoiceId: string, db?: Db) {
  return !!(await one(
    "SELECT 1 FROM invoices i JOIN invoice_flags f ON f.parsed_invoice_id=i.parsed_invoice_id WHERE i.invoice_id=$1 AND f.category='fraud' AND f.status='open'",
    [invoiceId],
    db,
  ));
}

const reference = (kind: string) => `BRIM-${kind}-${String(randomInt(10_000_000, 99_999_999))}`;

// Release: who may release comes from the payment policies, never by an approver of the invoice,
// refused while the vendor's latest bank change is unverified. The payment goes to the bank: it gets its reference (a cheque its number,
// and it is then outstanding until it clears), the bank account is snapshotted, and the instruction is written to the bank's outbox.
export async function releasePayment(actor: User | null, organizationId: string, paymentId: string) {
  assertCan(actor, "payment.release");
  const instruction = await tx(async (c) => {
    const pay = await one<{ payment_id: string; organization_id: string; invoice_id: string; vendor_id: string; method: string; scheduled_date: string | null;
      currency: string; amount: number; amount_cad: number; status: string }>(
      "SELECT * FROM payments WHERE payment_id=$1 AND organization_id=$2 FOR UPDATE",
      [paymentId, organizationId],
      c,
    );
    assertMember(actor, organizationId, { brim: true });
    if (!pay) throw new NotFoundError("No such payment");
    if (pay.status !== "scheduled") throw new ConflictError("Payment is not waiting for release");
    if (await openFraud(pay.invoice_id, c)) throw new ConflictError("A fraud flag on the invoice is open; the finance manager or the controller closes it first.");

    const approved = !!(await one("SELECT 1 FROM approvals WHERE invoice_id=$1 AND (acted_by=$2 OR on_behalf_of_user_id=$2) AND status='approved'", [pay.invoice_id, actor.user_id], c));
    const problem = releaseProblem(actor, await activePolicies(c, pay.organization_id, "payment"), Math.abs(pay.amount_cad), approved);
    if (problem) throw new ForbiddenError(problem);

    const change = await one<{ verified_by_callback: boolean; status: string; change_id: string }>(
      "SELECT verified_by_callback, status, change_id FROM vendor_bank_changes WHERE vendor_id=$1 ORDER BY requested_at DESC LIMIT 1",
      [pay.vendor_id],
      c,
    );
    if (change && (!change.verified_by_callback || change.status === "pending")) throw new ConflictError(`The vendor's bank change ${change.change_id} is not verified.`);
    // the cooling-off after a bank change: the money stays here until the vendor or a colleague has had time to catch a fraudulent change
    const held = (await heldVendors([pay.vendor_id], c)).get(pay.vendor_id);
    if (held) {
      throw new ConflictError(`The vendor's bank details changed recently (${held.change_id}): payments are held until ${held.hold_until}. Someone other than who requested or approved the change can lift the hold on the vendor's page.`);
    }

    const v = (await one<{ legal_name: string; bank_institution: string | null; bank_transit: string | null; bank_account: string | null }>(
      "SELECT legal_name, bank_institution, bank_transit, bank_account FROM vendors WHERE vendor_id=$1",
      [pay.vendor_id],
      c,
    ))!;
    const kind = pay.method === "EFT" ? "EFT" : pay.method === "CHEQUE" ? "CHQ" : "VC";
    const ref = reference(kind);
    // cheques are numbered after the highest number issued or cleared so far
    const chequeNumber = pay.method === "CHEQUE"
      ? (await one<{ n: number }>(
          `SELECT GREATEST(5000, (SELECT max(cheque_number) FROM payments WHERE organization_id=$1),
             (SELECT max(reference::int) FROM statement_lines WHERE organization_id=$1 AND kind='cheque')) + 1 AS n`,
          [pay.organization_id],
          c,
        ))!.n
      : null;
    await query(
      `UPDATE payments SET status=$7, released_by=$2, released_at=now(), snapshot_institution=$3, snapshot_transit=$4, snapshot_account=$5,
         bank_reference=$6, card_reference=$8, cheque_number=$9 WHERE payment_id=$1`,
      [paymentId, actor.user_id, v.bank_institution, v.bank_transit, v.bank_account, kind === "VC" ? null : ref,
        pay.method === "CHEQUE" ? "outstanding" : "released", kind === "VC" ? ref : null, chequeNumber],
      c,
    );
    await writeAudit(c, { organizationId: pay.organization_id, actor, action: "payment.release", entityType: "payment", entityId: paymentId, invoiceId: pay.invoice_id, paymentId, vendorId: pay.vendor_id, after: { ...v, reference: ref, cheque_number: chequeNumber } });
    return {
      payment_id: paymentId, invoice_id: pay.invoice_id, method: pay.method, scheduled_date: pay.scheduled_date, currency: pay.currency, amount: pay.amount,
      amount_cad: pay.amount_cad, vendor: v.legal_name, institution: v.bank_institution, transit: v.bank_transit, account: v.bank_account,
      reference: ref, cheque_number: chequeNumber, card_id: pay.method === "CARD" ? `VC-${pay.invoice_id}` : null, released_by: actor.user_id,
    };
  });
  // the bank picks the instruction up from its outbox once the payment is committed
  const outbox = path.join(process.env.BANK_DIR!, "outbox");
  mkdirSync(outbox, { recursive: true });
  writeFileSync(path.join(outbox, `${paymentId}.json`), JSON.stringify(instruction, null, 2));
}

// Cancel: stops a scheduled payment before it is released, and puts its invoice back to approved so it can be prepared again.
// Those who may release payments may cancel any; an AP clerk only the ones they prepared. Once released it has gone to the bank.
export async function cancelPayment(actor: User | null, organizationId: string, paymentId: string, reason: string) {
  assertCan(actor, "payment.cancel");
  if (!reason.trim()) throw new ValidationError("A reason is required to cancel a payment");
  return tx(async (c) => {
    assertMember(actor, organizationId, { brim: true });
    const pay = await one<{ payment_id: string; organization_id: string; invoice_id: string; vendor_id: string; status: string; prepared_by: string | null }>(
      "SELECT payment_id, organization_id, invoice_id, vendor_id, status, prepared_by FROM payments WHERE payment_id=$1 AND organization_id=$2 FOR UPDATE",
      [paymentId, organizationId],
      c,
    );
    if (!pay) throw new NotFoundError("No such payment");
    const problem = cancelProblem(actor, pay);
    if (problem) throw (pay.status !== "scheduled" ? new ConflictError(problem) : new ForbiddenError(problem));
    await query("UPDATE payments SET status='cancelled', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3 WHERE payment_id=$1", [paymentId, actor.user_id, reason.trim()], c);
    await query("UPDATE invoices SET status='approved' WHERE invoice_id=$1 AND status='scheduled'", [pay.invoice_id], c);
    await writeAudit(c, { organizationId: pay.organization_id, actor, action: "payment.cancel", entityType: "payment", entityId: paymentId, invoiceId: pay.invoice_id, paymentId, vendorId: pay.vendor_id,
      before: { status: "scheduled" }, after: { status: "cancelled", reason: reason.trim() } });
  });
}

// Why the user may not cancel this payment, or null when they can: the same rule for the API and the buttons.
export function cancelProblem(actor: User, pay: { status: string; prepared_by: string | null }): string | null {
  if (!can(actor, "payment.cancel")) return "Not allowed: payment.cancel";
  if (pay.status !== "scheduled") return "Only a scheduled payment can be cancelled; this one is " + pay.status + ".";
  if (!can(actor, "payment.release") && pay.prepared_by !== actor.user_id) return "You can only cancel payments you prepared.";
  return null;
}

// Vendors whose payments are held after a bank change, with the change and the date the hold ends. Any held change counts,
// not only the latest requested: changes can be approved out of order, and the account in use is the last one approved.
async function heldVendors(vendorIds: string[], db?: Db) {
  const rows = await query<{ vendor_id: string; change_id: string; hold_until: string }>(
    `SELECT DISTINCT ON (vendor_id) vendor_id, change_id, to_char(hold_until, 'YYYY-MM-DD') hold_until FROM vendor_bank_changes
      WHERE vendor_id = ANY($1) AND status='approved' AND hold_until > $2::date AND hold_waived_by IS NULL
      ORDER BY vendor_id, hold_until DESC`,
    [vendorIds, today()],
    db,
  );
  return new Map(rows.map((r) => [r.vendor_id, r]));
}

// Why the user cannot release each scheduled payment, or null when they can: the same rules as releasePayment.
export async function releaseBlocks(actor: User, orgId: string, rows: { payment_id: string; invoice_id: string; vendor_id: string; amount_cad: number; status: string }[]) {
  const out = new Map<string, string | null>();
  const scheduled = rows.filter((r) => r.status === "scheduled");
  if (!scheduled.length) return out;
  const policies = await activePolicies(pool, orgId, "payment");
  const approvedByMe = new Set((await query<{ invoice_id: string }>(
    "SELECT DISTINCT invoice_id FROM approvals WHERE invoice_id = ANY($1) AND status='approved' AND (acted_by=$2 OR on_behalf_of_user_id=$2)",
    [scheduled.map((r) => r.invoice_id), actor.user_id],
  )).map((r) => r.invoice_id));
  const unverified = new Set((await query<{ vendor_id: string }>(
    `SELECT DISTINCT ON (vendor_id) vendor_id, verified_by_callback, status FROM vendor_bank_changes WHERE vendor_id = ANY($1) ORDER BY vendor_id, requested_at DESC`,
    [scheduled.map((r) => r.vendor_id)],
  )).filter((c) => !(c as unknown as { verified_by_callback: boolean }).verified_by_callback || (c as unknown as { status: string }).status === "pending").map((c) => c.vendor_id));
  const held = await heldVendors(scheduled.map((r) => r.vendor_id));
  const fraud = new Set((await query<{ invoice_id: string }>(
    "SELECT DISTINCT i.invoice_id FROM invoices i JOIN invoice_flags f ON f.parsed_invoice_id=i.parsed_invoice_id WHERE i.invoice_id = ANY($1) AND f.category='fraud' AND f.status='open'",
    [scheduled.map((r) => r.invoice_id)],
  )).map((r) => r.invoice_id));
  for (const r of scheduled) {
    out.set(r.payment_id,
      releaseProblem(actor, policies, Math.abs(r.amount_cad), approvedByMe.has(r.invoice_id))
        ?? (unverified.has(r.vendor_id) ? "The vendor's bank change is not verified." : null)
        ?? (held.has(r.vendor_id) ? `The vendor's bank details changed recently: payments are held until ${held.get(r.vendor_id)!.hold_until}.` : null)
        ?? (fraud.has(r.invoice_id) ? "A fraud flag on the invoice is open." : null));
  }
  return out;
}

// The actor's place in the release ranking: the controller who reports to nobody is the CFO.
const rankOf = (actor: User) => RELEASE_RANK.indexOf(actor.role === "controller_admin" ? (actor.manager_id ? "controller" : "cfo") : actor.role);

// Why the user may not release a payment of this amount under the payment policies, or null.
function releaseProblem(actor: User, policies: Policy[], amount: number, approvedTheInvoice: boolean): string | null {
  const applying = policies.filter((p) => matches(p, { any_payment: true, payment_amount: amount }));
  const separation = applying.find((p) => p.required.includes("not_approver"));
  if (separation && approvedTheInvoice) return `You approved this invoice, so you cannot release its payment (policy ${separation.rule_id}).`;
  const needed = applying.flatMap((p) => p.required.filter((r) => RELEASE_RANK.includes(r)).map((r) => ({ rank: RELEASE_RANK.indexOf(r), rule: p.rule_id })))
    .sort((a, b) => b.rank - a.rank)[0];
  if (!needed) return "No payment policy says who may release this amount.";
  if (rankOf(actor) < needed.rank) return `This payment needs the ${REQUIREMENTS[RELEASE_RANK[needed.rank]].label.toLowerCase()} or above (policy ${needed.rule}).`;
  return null;
}
