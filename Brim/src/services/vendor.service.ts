import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { tx, query, one, nextId } from "@/lib/db";
import { assertMember, authorize, isBrim } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { blankToNull } from "@/lib/values";
import type { User } from "@/lib/types";

const FIELDS = [
  "legal_name", "category", "default_gl_account", "address", "province_or_state", "country", "gst_hst_number", "qst_number",
  "payment_terms_days", "early_pay_discount", "preferred_payment_method", "accepts_card_payment", "ap_contact_email", "requires_po",
] as const;
const BANK = ["bank_institution", "bank_transit", "bank_account"] as const;
export type VendorInput = Partial<Record<(typeof FIELDS)[number] | (typeof BANK)[number] | "vendor_id" | "status" | "onboarded_at", unknown>>;

export type Vendor = {
  vendor_id: string; legal_name: string; category: string | null; province_or_state: string | null; country: string | null; preferred_payment_method: string;
  status: string; gst_hst_number: string | null; bank_institution: string | null; bank_transit: string | null; bank_account: string | null;
} & Record<string, string | number | boolean | null>;

// Vendors with their number of invoices and whether a bank change is pending or unverified.
export async function listVendors(actor: User | null, organizationId: string, status?: string | null) {
  authorize(actor, organizationId, isBrim(actor) ? "vendor.onboard" : "vendor.view");
  return query<Vendor & { invoices: number; pending_change: boolean }>(
    `SELECT v.*, (SELECT count(*)::int FROM invoices i WHERE i.vendor_id=v.vendor_id) invoices,
       EXISTS (SELECT 1 FROM vendor_bank_changes c WHERE c.vendor_id=v.vendor_id AND (c.status='pending' OR NOT c.verified_by_callback)) pending_change
     FROM vendors v WHERE v.organization_id=$1 AND ($2::text IS NULL OR v.status=$2) ORDER BY v.legal_name`,
    [organizationId, status || null],
  );
}

export async function getVendor(actor: User | null, organizationId: string, vendorId: string) {
  authorize(actor, organizationId, isBrim(actor) ? "vendor.onboard" : "vendor.view");
  const v = await one<Vendor>("SELECT * FROM vendors WHERE organization_id=$1 AND vendor_id=$2", [organizationId, vendorId]);
  if (!v) throw new NotFoundError("No such vendor");
  return v;
}

// A new vendor waits as pending_review until the finance manager approves it.
// A Brim employee setting up an organization's existing vendor master can give the status it already has.
export async function createVendor(actor: User | null, organizationId: string, v: VendorInput) {
  authorize(actor, organizationId, "vendor.onboard");
  if (!v.legal_name) throw new ValidationError("A legal name is required");
  return tx(async (c) => {
    const id = String(v.vendor_id ?? (await nextId("V", c)));
    const status = isBrim(actor) && v.status ? v.status : "pending_review";
    const cols = [...FIELDS, ...BANK].filter((f) => f in v);
    await query(
      `INSERT INTO vendors (vendor_id, organization_id, status, onboarded_at, ${cols.join(",")})
       VALUES ($1,$2,$3,COALESCE($4::date, current_date),${cols.map((_, i) => `$${i + 5}`).join(",")})`,
      [id, organizationId, status, blankToNull(v.onboarded_at), ...cols.map((f) => blankToNull(v[f]))],
      c,
    );
    await writeAudit(c, { organizationId, actor, action: "vendor.create", entityType: "vendor", entityId: id, vendorId: id, after: v });
    return id;
  });
}

// Edits any field except the bank details (a bank change request) and the status (approve / hold).
export async function updateVendor(actor: User | null, organizationId: string, vendorId: string, v: VendorInput) {
  authorize(actor, organizationId, "vendor.onboard");
  if (BANK.some((f) => f in v)) throw new ValidationError("Bank details change only through a bank change request");
  if ("status" in v) throw new ValidationError("Use approve or hold to change the status");
  await tx(async (c) => {
    const before = await one("SELECT * FROM vendors WHERE organization_id=$1 AND vendor_id=$2 FOR UPDATE", [organizationId, vendorId], c);
    if (!before) throw new NotFoundError("No such vendor");
    const cols = FIELDS.filter((f) => f in v);
    if (!cols.length) return;
    await query(`UPDATE vendors SET ${cols.map((f, i) => `${f}=$${i + 2}`).join(", ")} WHERE vendor_id=$1`, [vendorId, ...cols.map((f) => blankToNull(v[f]))], c);
    await writeAudit(c, { organizationId, actor, action: "vendor.update", entityType: "vendor", entityId: vendorId, vendorId, before, after: v });
  });
}

export async function setVendorStatus(actor: User | null, organizationId: string, vendorId: string, status: "active" | "on_hold") {
  authorize(actor, organizationId, "vendor.approve");
  await tx(async (c) => {
    const before = await one<{ status: string }>("SELECT status FROM vendors WHERE organization_id=$1 AND vendor_id=$2 FOR UPDATE", [organizationId, vendorId], c);
    if (!before) throw new NotFoundError("No such vendor");
    await query("UPDATE vendors SET status=$2, approved_by=CASE WHEN $2='active' THEN $3 ELSE approved_by END WHERE vendor_id=$1", [vendorId, status, actor.user_id], c);
    await writeAudit(c, { organizationId, actor, action: `vendor.${status === "active" ? "approve" : "hold"}`, entityType: "vendor", entityId: vendorId, vendorId, before, after: { status } });
  });
}

// --- bank details changes ---

// Bank details changes, newest first: one vendor's, and/or the open ones (pending, or applied without a callback).
export async function listBankChanges(actor: User | null, organizationId: string, f: { vendorId?: string | null; open?: boolean } = {}) {
  if (f.vendorId) await getVendor(actor, organizationId, f.vendorId);
  else authorize(actor, organizationId, isBrim(actor) ? "vendor.onboard" : "vendor.view");
  return query<{ change_id: string; vendor_id: string; vendor_name: string; requested_at: string; requester: string | null; request_channel: string; new_institution: string | null; new_transit: string | null; new_account: string; verified_by_callback: boolean; status: string; approver: string | null }>(
    `SELECT c.*, v.legal_name vendor_name, u1.full_name requester, u2.full_name approver FROM vendor_bank_changes c JOIN vendors v USING (vendor_id)
       LEFT JOIN users u1 ON u1.user_id=c.requested_by LEFT JOIN users u2 ON u2.user_id=c.approved_by
      WHERE v.organization_id=$1 AND ($2::text IS NULL OR c.vendor_id=$2) AND (NOT $3 OR c.status='pending' OR NOT c.verified_by_callback)
      ORDER BY c.requested_at DESC`,
    [organizationId, f.vendorId ?? null, !!f.open],
  );
}

async function changeInOrg(c: Parameters<Parameters<typeof tx>[0]>[0], organizationId: string, changeId: string) {
  const ch = await one<{ change_id: string; vendor_id: string; status: string; verified_by_callback: boolean; requested_by: string | null; new_institution: string; new_transit: string; new_account: string }>(
    `SELECT c.* FROM vendor_bank_changes c JOIN vendors v USING (vendor_id) WHERE c.change_id=$1 AND v.organization_id=$2 FOR UPDATE OF c`,
    [changeId, organizationId],
    c,
  );
  if (!ch) throw new NotFoundError("No such bank change");
  return ch;
}

// A change of bank details is a request; the vendor's bank fields change only when the finance manager approves it after a callback.
// A Brim employee recording an organization's past changes gives their recorded status.
export async function requestBankChange(
  actor: User | null,
  organizationId: string,
  vendorId: string,
  input: { change_id?: string; institution?: string | null; transit?: string | null; account: string; channel: string; verified_by_callback?: boolean; requested_at?: string; requested_by?: string; status?: string },
) {
  authorize(actor, organizationId, isBrim(actor) ? "vendor.onboard" : "bank_change.request");
  return tx(async (c) => {
    const v = await one("SELECT 1 FROM vendors WHERE vendor_id=$1 AND organization_id=$2", [vendorId, organizationId], c);
    if (!v) throw new NotFoundError("No such vendor");
    const id = input.change_id ?? (await nextId("BC", c));
    const past = isBrim(actor);
    await query(
      `INSERT INTO vendor_bank_changes (change_id, vendor_id, requested_at, requested_by, request_channel, new_institution, new_transit, new_account, verified_by_callback, status)
       VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4,$5,$6,$7,$8,$9,$10)`,
      [id, vendorId, past ? input.requested_at ?? null : null, past ? input.requested_by ?? null : actor.user_id, input.channel, input.institution ?? null, input.transit ?? null,
        input.account, !!input.verified_by_callback, past && input.status ? input.status : "pending"],
      c,
    );
    await writeAudit(c, { organizationId, actor, action: "bank_change.request", entityType: "vendor_bank_change", entityId: id, vendorId, after: input });
    return id;
  });
}

export async function decideBankChange(actor: User | null, organizationId: string, changeId: string, decision: "approved" | "rejected", verifiedByCallback: boolean) {
  authorize(actor, organizationId, "bank_change.approve");
  await tx(async (c) => {
    const ch = await changeInOrg(c, organizationId, changeId);
    if (ch.status !== "pending") throw new ConflictError("Not pending");
    if (ch.requested_by === actor.user_id) throw new ForbiddenError("You requested this change; someone else approves it.");
    if (decision === "approved" && !verifiedByCallback) throw new ValidationError("Confirm the change by calling the vendor on the number already on file.");
    const v = (await one("SELECT bank_institution, bank_transit, bank_account FROM vendors WHERE vendor_id=$1", [ch.vendor_id], c))!;
    await query("UPDATE vendor_bank_changes SET status=$2, verified_by_callback=$3, approved_by=$4, approved_at=now() WHERE change_id=$1", [changeId, decision, verifiedByCallback, actor.user_id], c);
    if (decision === "approved") {
      await query("UPDATE vendors SET bank_institution=$2, bank_transit=$3, bank_account=$4 WHERE vendor_id=$1", [ch.vendor_id, ch.new_institution, ch.new_transit, ch.new_account], c);
    }
    await writeAudit(c, {
      organizationId, actor, action: `bank_change.${decision === "approved" ? "approve" : "reject"}`, entityType: "vendor_bank_change", entityId: changeId, vendorId: ch.vendor_id,
      before: v, after: decision === "approved" ? { institution: ch.new_institution, transit: ch.new_transit, account: ch.new_account } : undefined,
    });
  });
}

// A change already applied without a callback (e.g. one made by email) is confirmed by calling the vendor.
export async function confirmBankChangeByCallback(actor: User | null, organizationId: string, changeId: string) {
  authorize(actor, organizationId, "bank_change.approve");
  await tx(async (c) => {
    const ch = await changeInOrg(c, organizationId, changeId);
    if (ch.status !== "approved" || ch.verified_by_callback) throw new ConflictError("Nothing to confirm");
    await query("UPDATE vendor_bank_changes SET verified_by_callback=true, approved_by=$2, approved_at=now() WHERE change_id=$1", [changeId, actor.user_id], c);
    await writeAudit(c, { organizationId, actor, action: "bank_change.confirm_callback", entityType: "vendor_bank_change", entityId: changeId, vendorId: ch.vendor_id });
  });
}

// Names to pick a vendor from, for anyone in the organization (the invoice form, the clerk's review).
export async function listVendorChoices(user: User | null, organizationId: string) {
  assertMember(user, organizationId);
  return query<{ vendor_id: string; legal_name: string; status: string }>("SELECT vendor_id, legal_name, status FROM vendors WHERE organization_id=$1 ORDER BY legal_name", [organizationId]);
}
