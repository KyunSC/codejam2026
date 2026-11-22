import { tx, query, one, nextId } from "@/lib/db";
import { assertCan, assertOrg, ForbiddenError } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

export type VendorInput = {
  legal_name: string;
  category: string | null;
  default_gl_account: string | null;
  address: string | null;
  province_or_state: string | null;
  country: string;
  gst_hst_number: string | null;
  qst_number: string | null;
  payment_terms_days: number | null;
  preferred_payment_method: "EFT" | "CHEQUE" | "CARD";
  bank_institution: string | null;
  bank_transit: string | null;
  bank_account: string | null;
  ap_contact_email: string | null;
  requires_po: boolean;
};

// Onboarding: a new vendor waits as pending_review until the finance manager approves it.
export async function onboardVendor(actor: User | null, v: VendorInput) {
  assertCan(actor, "vendor.onboard");
  return tx(async (c) => {
    const id = await nextId("V", c);
    await query(
      `INSERT INTO vendors (vendor_id, organization_id, legal_name, category, default_gl_account, address, province_or_state, country, gst_hst_number, qst_number,
         payment_terms_days, preferred_payment_method, bank_institution, bank_transit, bank_account, ap_contact_email, requires_po, status, onboarded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending_review',current_date)`,
      [id, actor.organization_id, v.legal_name, v.category, v.default_gl_account, v.address, v.province_or_state, v.country, v.gst_hst_number, v.qst_number,
        v.payment_terms_days, v.preferred_payment_method, v.bank_institution, v.bank_transit, v.bank_account, v.ap_contact_email, v.requires_po],
      c,
    );
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "vendor.onboard", entityType: "vendor", entityId: id, vendorId: id, after: v });
    return id;
  });
}

export async function setVendorStatus(actor: User | null, vendorId: string, status: "active" | "on_hold") {
  assertCan(actor, "vendor.approve");
  await tx(async (c) => {
    const before = await one<{ organization_id: string; status: string }>("SELECT organization_id, status FROM vendors WHERE vendor_id=$1", [vendorId], c);
    if (!before) throw new ForbiddenError("No such vendor");
    assertOrg(actor, before.organization_id);
    await query("UPDATE vendors SET status=$2, approved_by=CASE WHEN $2='active' THEN $3 ELSE approved_by END WHERE vendor_id=$1", [vendorId, status, actor.user_id], c);
    await writeAudit(c, { organizationId: before.organization_id, actor, action: `vendor.${status}`, entityType: "vendor", entityId: vendorId, vendorId, before, after: { status } });
  });
}

// A change of bank details is a request; the vendor's bank fields change only when the finance manager approves it after a callback.
export async function requestBankChange(actor: User | null, vendorId: string, input: { institution: string; transit: string; account: string; channel: string; verifiedByCallback: boolean }) {
  assertCan(actor, "bank_change.request");
  return tx(async (c) => {
    const v = await one<{ organization_id: string }>("SELECT organization_id FROM vendors WHERE vendor_id=$1", [vendorId], c);
    if (!v) throw new ForbiddenError("No such vendor");
    assertOrg(actor, v.organization_id);
    const id = await nextId("BC", c);
    await query(
      `INSERT INTO vendor_bank_changes (change_id, vendor_id, requested_by, request_channel, new_institution, new_transit, new_account, verified_by_callback, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [id, vendorId, actor.user_id, input.channel, input.institution, input.transit, input.account, input.verifiedByCallback],
      c,
    );
    await writeAudit(c, { organizationId: v.organization_id, actor, action: "bank_change.request", entityType: "vendor_bank_change", entityId: id, vendorId, after: input });
    return id;
  });
}

// A change already applied without a callback (e.g. one made by email) is confirmed by calling the vendor.
export async function confirmBankChangeByCallback(actor: User | null, changeId: string) {
  assertCan(actor, "bank_change.approve");
  await tx(async (c) => {
    const ch = await one<{ vendor_id: string; status: string; verified_by_callback: boolean }>("SELECT * FROM vendor_bank_changes WHERE change_id=$1 FOR UPDATE", [changeId], c);
    if (!ch || ch.status !== "approved" || ch.verified_by_callback) throw new ForbiddenError("Nothing to confirm");
    const v = (await one<{ organization_id: string }>("SELECT organization_id FROM vendors WHERE vendor_id=$1", [ch.vendor_id], c))!;
    assertOrg(actor, v.organization_id);
    await query("UPDATE vendor_bank_changes SET verified_by_callback=true, approved_by=$2, approved_at=now() WHERE change_id=$1", [changeId, actor.user_id], c);
    await writeAudit(c, { organizationId: v.organization_id, actor, action: "bank_change.callback_confirmed", entityType: "vendor_bank_change", entityId: changeId, vendorId: ch.vendor_id });
  });
}

export async function decideBankChange(actor: User | null, changeId: string, decision: "approved" | "rejected", verifiedByCallback: boolean) {
  assertCan(actor, "bank_change.approve");
  await tx(async (c) => {
    const ch = await one<{ vendor_id: string; status: string; requested_by: string; new_institution: string; new_transit: string; new_account: string }>(
      "SELECT * FROM vendor_bank_changes WHERE change_id=$1 FOR UPDATE",
      [changeId],
      c,
    );
    if (!ch || ch.status !== "pending") throw new ForbiddenError("Not pending");
    if (ch.requested_by === actor.user_id) throw new ForbiddenError("You requested this change; someone else approves it.");
    const v = (await one<{ organization_id: string; bank_institution: string; bank_transit: string; bank_account: string }>("SELECT * FROM vendors WHERE vendor_id=$1", [ch.vendor_id], c))!;
    assertOrg(actor, v.organization_id);
    if (decision === "approved" && !verifiedByCallback) throw new ForbiddenError("Confirm the change by calling the vendor on the number already on file.");
    await query("UPDATE vendor_bank_changes SET status=$2, verified_by_callback=$3, approved_by=$4, approved_at=now() WHERE change_id=$1", [changeId, decision, verifiedByCallback, actor.user_id], c);
    if (decision === "approved") {
      await query("UPDATE vendors SET bank_institution=$2, bank_transit=$3, bank_account=$4 WHERE vendor_id=$1", [ch.vendor_id, ch.new_institution, ch.new_transit, ch.new_account], c);
    }
    await writeAudit(c, {
      organizationId: v.organization_id, actor, action: `bank_change.${decision}`, entityType: "vendor_bank_change", entityId: changeId, vendorId: ch.vendor_id,
      before: { institution: v.bank_institution, transit: v.bank_transit, account: v.bank_account },
      after: decision === "approved" ? { institution: ch.new_institution, transit: ch.new_transit, account: ch.new_account } : undefined,
    });
  });
}
