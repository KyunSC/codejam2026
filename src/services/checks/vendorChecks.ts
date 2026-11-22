import { query } from "@/lib/db";
import { sameName } from "@/lib/normalize";
import type { CheckContext, Flag, Vendor } from "./types";

export async function vendorChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor } = ctx;
  const flags: Flag[] = [];

  if (!vendor) {
    flags.push({
      check_code: "vendor_unknown",
      category: "vendor",
      severity: "blocking",
      message: `"${d.vendor_name ?? "Unknown vendor"}" is not in the vendor master. Onboard the vendor or pick an existing one.`,
      evidence: { found: { name: d.vendor_name, gst_hst: d.vendor_gst_hst_number } },
    });
    return flags;
  }

  if (vendor.status === "on_hold") {
    flags.push({ check_code: "vendor_on_hold", category: "vendor", severity: "blocking", message: `${vendor.legal_name} is on hold.` });
  } else if (vendor.status === "pending_review") {
    flags.push({ check_code: "vendor_pending", category: "vendor", severity: "warning", message: `${vendor.legal_name} is not yet approved; the finance manager is added to the approval chain.` });
  }

  // Lookalike: this vendor's name is within a few letters of an established vendor's once cleaned (Levenshtein),
  // and this one has fewer past invoices (the established vendor's own invoices are not flagged).
  const others = await query<Vendor & { n: number }>(
    "SELECT v.*, (SELECT count(*) FROM invoices i WHERE i.vendor_id=v.vendor_id)::int AS n FROM vendors v WHERE v.organization_id=$1 AND v.vendor_id<>$2",
    [ctx.organizationId, vendor.vendor_id],
    ctx.db,
  );
  const mine = await query<{ n: number }>("SELECT count(*)::int AS n FROM invoices WHERE vendor_id=$1", [vendor.vendor_id], ctx.db);
  for (const o of others) {
    if (sameName(o.legal_name, vendor.legal_name) && (mine[0]?.n ?? 0) < o.n) {
      const sameBank = o.bank_account && o.bank_account === vendor.bank_account;
      flags.push({
        check_code: "vendor_lookalike",
        category: "vendor",
        severity: "warning",
        message: `${vendor.legal_name} (${vendor.vendor_id}) looks like ${o.legal_name} (${o.vendor_id})${sameBank ? ", with the same bank account" : ", with a different bank account"}. Confirm this is the right vendor.`,
        evidence: { this: { id: vendor.vendor_id, account: vendor.bank_account, email: vendor.ap_contact_email }, other: { id: o.vendor_id, account: o.bank_account, email: o.ap_contact_email } },
      });
    }
  }
  return flags;
}
