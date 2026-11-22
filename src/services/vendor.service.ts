import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { tx, query, one, nextId } from "@/lib/db";
import { assertMember, authorize } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { blankToNull } from "@/lib/values";
import { vendorName } from "@/lib/normalize";
import type { User } from "@/lib/types";
import { window, type Paging } from "@/lib/paging";

const FIELDS = [
  "legal_name", "category", "default_gl_account", "address", "province_or_state", "country", "gst_hst_number", "qst_number",
  "payment_terms_days", "early_pay_discount", "preferred_payment_method", "accepts_card_payment", "ap_contact_email", "phone", "requires_po",
] as const;
const BANK = ["bank_institution", "bank_transit", "bank_account"] as const;
export type VendorInput = Partial<Record<(typeof FIELDS)[number] | (typeof BANK)[number], unknown>>;

export type Vendor = {
  vendor_id: string; legal_name: string; category: string | null; province_or_state: string | null; country: string | null; preferred_payment_method: string;
  status: string; gst_hst_number: string | null; bank_institution: string | null; bank_transit: string | null; bank_account: string | null;
} & Record<string, string | number | boolean | null>;

// A name with case, punctuation and the company suffix taken off: two vendors with the same key look alike.
const nameKey = (s: string) => vendorName(s).replace(/ (inc|ltd|llp)$/, "");

// The organization's other vendors whose names look like this one.
async function lookalikesOf(organizationId: string, vendorId: string | null, legalName: string) {
  const all = await query<{ vendor_id: string; legal_name: string }>("SELECT vendor_id, legal_name FROM vendors WHERE organization_id=$1", [organizationId]);
  return all.filter((o) => o.vendor_id !== vendorId && nameKey(o.legal_name) === nameKey(legalName));
}

// Vendors with their number of invoices, whether a bank change is pending or unverified,
// and the other vendors of the organization (in any status) with a lookalike name.
export async function listVendors(actor: User | null, organizationId: string, f: Paging & { status?: string | null; q?: string | null } = {}) {
  authorize(actor, organizationId, "vendor.view");
  const all = await query<{ vendor_id: string; legal_name: string }>("SELECT vendor_id, legal_name FROM vendors WHERE organization_id=$1", [organizationId]);
  const { limit, offset } = window(f);
  const rows = await query<Vendor & { invoices: number; pending_change: boolean; total_count: number }>(
    `SELECT v.*, count(*) OVER ()::int AS total_count, (SELECT count(*)::int FROM invoices i WHERE i.vendor_id=v.vendor_id) invoices,
       EXISTS (SELECT 1 FROM vendor_bank_changes c WHERE c.vendor_id=v.vendor_id AND (c.status='pending' OR NOT c.verified_by_callback)) pending_change
     FROM vendors v WHERE v.organization_id=$1 AND ($2::text IS NULL OR v.status=$2)
       AND ($3::text IS NULL OR strpos(lower(v.vendor_id), lower($3)) > 0 OR strpos(lower(v.legal_name), lower($3)) > 0)
     ORDER BY v.legal_name, v.vendor_id LIMIT ${limit} OFFSET ${offset}`,
    [organizationId, f.status || null, f.q?.trim() || null],
  );
  return rows.map((v) => ({ ...v, lookalike_of: all.filter((o) => o.vendor_id !== v.vendor_id && nameKey(o.legal_name) === nameKey(v.legal_name)) }));
}

export async function getVendor(actor: User | null, organizationId: string, vendorId: string) {
  authorize(actor, organizationId, "vendor.view");
  const v = await one<Vendor>("SELECT * FROM vendors WHERE organization_id=$1 AND vendor_id=$2", [organizationId, vendorId]);
  if (!v) throw new NotFoundError("No such vendor");
  return { ...v, lookalike_of: await lookalikesOf(organizationId, vendorId, v.legal_name) } as Vendor & { lookalike_of: { vendor_id: string; legal_name: string }[] };
}

// What is typed for a vendor must be well formed.
function checkVendorFields(v: VendorInput) {
  const bad = (k: keyof VendorInput, ok: (s: string) => boolean, message: string) => {
    const s = v[k] == null ? "" : String(v[k]).trim();
    if (s && !ok(s)) throw new ValidationError(message);
  };
  bad("gst_hst_number", (s) => /^\d{9}RT\d{4}$/.test(s), "A GST/HST number looks like 123456789RT0001.");
  bad("qst_number", (s) => /^\d{10}TQ\d{4}$/.test(s), "A QST number looks like 1234567890TQ0001.");
  bad("payment_terms_days", (s) => /^\d+$/.test(s) && Number(s) <= 365, "Payment terms are a number of days from 0 to 365.");
  bad("ap_contact_email", (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "Give a valid billing email.");
  bad("bank_institution", (s) => /^\d{3}$/.test(s), "A bank institution number has 3 digits.");
  bad("bank_transit", (s) => /^\d{5}$/.test(s), "A transit number has 5 digits.");
  bad("bank_account", (s) => /^\d{7,12}$/.test(s), "A bank account number has 7 to 12 digits.");
}

// A new vendor waits as pending_review until the finance manager approves it.
// A Brim employee setting up an organization's existing vendor master can give the status it already has.
export async function createVendor(actor: User | null, organizationId: string, v: VendorInput) {
  authorize(actor, organizationId, "vendor.onboard");
  if (!v.legal_name) throw new ValidationError("A legal name is required");
  checkVendorFields(v);
  return tx(async (c) => {
    const id = await nextId("V", c);
    const cols = [...FIELDS, ...BANK].filter((f) => f in v);
    await query(
      `INSERT INTO vendors (vendor_id, organization_id, status, onboarded_at, onboarded_by, ${cols.join(",")})
       VALUES ($1,$2,'pending_review',$3,$4,${cols.map((_, i) => `$${i + 5}`).join(",")})`,
      [id, organizationId, today(), actor.user_id, ...cols.map((f) => blankToNull(v[f]))],
      c,
    );
    await writeAudit(c, { organizationId, actor, action: "vendor.create", entityType: "vendor", entityId: id, vendorId: id, after: v });
    return id;
  });
}

// Edits any field except the bank details (a bank change request) and the status (approve / hold).
export async function updateVendor(actor: User | null, organizationId: string, vendorId: string, v: VendorInput) {
  authorize(actor, organizationId, "vendor.onboard");
  checkVendorFields(v);
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

// Deletes a vendor nothing points to; one with invoices, orders, contracts, payments or bank changes keeps its history and is put on hold instead.
export async function deleteVendor(actor: User | null, organizationId: string, vendorId: string) {
  authorize(actor, organizationId, "vendor.onboard");
  await tx(async (c) => {
    const before = await one("SELECT * FROM vendors WHERE organization_id=$1 AND vendor_id=$2 FOR UPDATE", [organizationId, vendorId], c);
    if (!before) throw new NotFoundError("No such vendor");
    try {
      await query("SAVEPOINT vendor_delete", [], c);
      await query("DELETE FROM vendors WHERE vendor_id=$1", [vendorId], c);
    } catch {
      await query("ROLLBACK TO SAVEPOINT vendor_delete", [], c);
      throw new ConflictError(`${vendorId} has invoices, orders, contracts, payments or bank changes, so it cannot be deleted; put it on hold instead.`);
    }
    await writeAudit(c, { organizationId, actor, action: "vendor.delete", entityType: "vendor", entityId: vendorId, vendorId, before });
  });
}

export async function setVendorStatus(actor: User | null, organizationId: string, vendorId: string, status: "active" | "on_hold") {
  authorize(actor, organizationId, "vendor.approve");
  await tx(async (c) => {
    const before = await one<{ status: string; onboarded_by: string | null }>("SELECT status, onboarded_by FROM vendors WHERE organization_id=$1 AND vendor_id=$2 FOR UPDATE", [organizationId, vendorId], c);
    if (!before) throw new NotFoundError("No such vendor");
    if (status === "active" && before.onboarded_by === actor.user_id) throw new ForbiddenError("You onboarded this vendor; someone else approves it.");
    await query("UPDATE vendors SET status=$2, approved_by=CASE WHEN $2='active' THEN $3 ELSE approved_by END WHERE vendor_id=$1", [vendorId, status, actor.user_id], c);
    await writeAudit(c, { organizationId, actor, action: `vendor.${status === "active" ? "approve" : "hold"}`, entityType: "vendor", entityId: vendorId, vendorId, before, after: { status } });
  });
}

// --- bank details changes ---

// Bank details changes, newest first: one vendor's, and/or the open ones (pending, or applied without a callback).
export async function listBankChanges(actor: User | null, organizationId: string, f: { vendorId?: string | null; open?: boolean } = {}) {
  if (f.vendorId) await getVendor(actor, organizationId, f.vendorId);
  else authorize(actor, organizationId, "vendor.view");
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
export async function requestBankChange(
  actor: User | null,
  organizationId: string,
  vendorId: string,
  input: { institution?: string | null; transit?: string | null; account: string; channel: string; verified_by_callback?: boolean },
) {
  authorize(actor, organizationId, "bank_change.request");
  checkVendorFields({ bank_institution: input.institution, bank_transit: input.transit, bank_account: input.account });
  return tx(async (c) => {
    const v = await one("SELECT 1 FROM vendors WHERE vendor_id=$1 AND organization_id=$2", [vendorId, organizationId], c);
    if (!v) throw new NotFoundError("No such vendor");
    const id = await nextId("BC", c);
    await query(
      `INSERT INTO vendor_bank_changes (change_id, vendor_id, requested_by, request_channel, new_institution, new_transit, new_account, verified_by_callback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, vendorId, actor.user_id, input.channel, input.institution ?? null, input.transit ?? null, input.account, !!input.verified_by_callback],
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
    if (decision === "approved" && !verifiedByCallback) {
      const vendor = await one<{ phone: string | null }>("SELECT phone FROM vendors WHERE vendor_id=$1", [ch.vendor_id], c);
      throw new ValidationError(vendor?.phone
        ? `Call the vendor at ${vendor.phone}, the number on file, to confirm the change, then tick "called the vendor".`
        : "This vendor has no phone number on file: add it from a trusted source, call to confirm the change, then tick \"called the vendor\".");
    }
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

// Vendors to pick from, for anyone in the organization (the invoice form, the clerk's review), with what the form fills in from them.
export async function listVendorChoices(user: User | null, organizationId: string) {
  assertMember(user, organizationId);
  return query<{ vendor_id: string; legal_name: string; status: string; payment_terms_days: number | null; country: string | null; category: string | null; requires_po: boolean }>(
    "SELECT vendor_id, legal_name, status, payment_terms_days, country, category, requires_po FROM vendors WHERE organization_id=$1 ORDER BY legal_name",
    [organizationId],
  );
}
