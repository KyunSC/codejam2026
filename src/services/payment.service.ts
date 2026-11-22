import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { tx, query, one, nextId } from "@/lib/db";
import { assertCan, assertMember } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
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

// Release: limits from the payment_release policies, never by an approver of the invoice,
// refused while the vendor's latest bank change is unverified; the bank account is snapshotted.
export async function releasePayment(actor: User | null, organizationId: string, paymentId: string) {
  assertCan(actor, "payment.release");
  await tx(async (c) => {
    const pay = await one<{ payment_id: string; organization_id: string; invoice_id: string; vendor_id: string; amount_cad: number; status: string }>(
      "SELECT * FROM payments WHERE payment_id=$1 AND organization_id=$2 FOR UPDATE",
      [paymentId, organizationId],
      c,
    );
    assertMember(actor, organizationId, { brim: true });
    if (!pay) throw new NotFoundError("No such payment");
    if (pay.status !== "scheduled") throw new ConflictError("Payment is not waiting for release");

    const limit = await releaseLimit(actor, pay.organization_id);
    if (limit !== null && Math.abs(pay.amount_cad) > limit) throw new ForbiddenError(`Your release limit is ${limit.toLocaleString("en-CA")} CAD; this payment needs the controller.`);
    const approved = await one("SELECT 1 FROM approvals WHERE invoice_id=$1 AND (acted_by=$2 OR on_behalf_of_user_id=$2) AND status='approved'", [pay.invoice_id, actor.user_id], c);
    if (approved) throw new ForbiddenError("You approved this invoice, so you cannot release its payment (policy P11).");

    const change = await one<{ verified_by_callback: boolean; status: string; change_id: string }>(
      "SELECT verified_by_callback, status, change_id FROM vendor_bank_changes WHERE vendor_id=$1 ORDER BY requested_at DESC LIMIT 1",
      [pay.vendor_id],
      c,
    );
    if (change && (!change.verified_by_callback || change.status === "pending")) throw new ConflictError(`The vendor's bank change ${change.change_id} is not verified.`);

    const v = (await one<{ bank_institution: string | null; bank_transit: string | null; bank_account: string | null }>("SELECT bank_institution, bank_transit, bank_account FROM vendors WHERE vendor_id=$1", [pay.vendor_id], c))!;
    await query(
      "UPDATE payments SET status='released', released_by=$2, released_at=now(), snapshot_institution=$3, snapshot_transit=$4, snapshot_account=$5 WHERE payment_id=$1",
      [paymentId, actor.user_id, v.bank_institution, v.bank_transit, v.bank_account],
      c,
    );
    await writeAudit(c, { organizationId: pay.organization_id, actor, action: "payment.release", entityType: "payment", entityId: paymentId, invoiceId: pay.invoice_id, paymentId, vendorId: pay.vendor_id, after: v });
  });
}

// Why the user cannot release each scheduled payment, or null when they can: the same rules as releasePayment.
export async function releaseBlocks(actor: User, orgId: string, rows: { payment_id: string; invoice_id: string; vendor_id: string; amount_cad: number; status: string }[]) {
  const out = new Map<string, string | null>();
  const scheduled = rows.filter((r) => r.status === "scheduled");
  if (!scheduled.length) return out;
  const limit = await releaseLimit(actor, orgId);
  const approvedByMe = new Set((await query<{ invoice_id: string }>(
    "SELECT DISTINCT invoice_id FROM approvals WHERE invoice_id = ANY($1) AND status='approved' AND (acted_by=$2 OR on_behalf_of_user_id=$2)",
    [scheduled.map((r) => r.invoice_id), actor.user_id],
  )).map((r) => r.invoice_id));
  const unverified = new Set((await query<{ vendor_id: string }>(
    `SELECT DISTINCT ON (vendor_id) vendor_id, verified_by_callback, status FROM vendor_bank_changes WHERE vendor_id = ANY($1) ORDER BY vendor_id, requested_at DESC`,
    [scheduled.map((r) => r.vendor_id)],
  )).filter((c) => !(c as unknown as { verified_by_callback: boolean }).verified_by_callback || (c as unknown as { status: string }).status === "pending").map((c) => c.vendor_id));
  for (const r of scheduled) {
    out.set(r.payment_id,
      approvedByMe.has(r.invoice_id) ? "You approved this invoice (policy P11)."
        : limit !== null && Math.abs(r.amount_cad) > limit ? `Above your release limit of ${limit.toLocaleString("en-CA")} CAD.`
          : unverified.has(r.vendor_id) ? "The vendor's bank change is not verified."
            : null);
  }
  return out;
}

async function releaseLimit(actor: User, orgId: string): Promise<number | null> {
  const rows = await query<{ trigger_type: string; trigger_value: number | null; step_role: string }>(
    "SELECT trigger_type, trigger_value, step_role FROM approval_policies WHERE organization_id=$1 AND rule_type='payment_release' AND is_active",
    [orgId],
  );
  const mine = rows.filter((r) => r.step_role === actor.role);
  if (mine.some((r) => r.trigger_type === "payment_over")) return null;
  const upto = mine.find((r) => r.trigger_type === "payment_upto");
  if (upto) return upto.trigger_value;
  return actor.role === "controller_admin" ? null : 0;
}
