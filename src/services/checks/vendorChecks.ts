import { query } from "@/lib/db";
import { taxNumber, vendorName } from "@/lib/normalize";
import type { CheckContext, Flag, Vendor } from "./types";

export async function vendorChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor, org } = ctx;
  const flags: Flag[] = [];

  const billedName = vendorName(d.bill_to_name);
  const billedTax = taxNumber(d.bill_to_tax_number);
  if ((billedName && !billedName.includes(vendorName(org.legal_name).split(" ")[0])) || (billedTax && org.gst_hst_number && billedTax !== taxNumber(org.gst_hst_number))) {
    flags.push({
      check_code: "bill_to_not_organization",
      category: "vendor",
      severity: "blocking",
      message: `Billed to "${d.bill_to_name ?? "?"}" (${d.bill_to_tax_number ?? "no tax number"}), not ${org.legal_name}.`,
      evidence: { expected: { name: org.legal_name, tax: org.gst_hst_number }, found: { name: d.bill_to_name, tax: d.bill_to_tax_number } },
    });
  }

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

  if (d.vendor_gst_hst_number && vendor.gst_hst_number && taxNumber(d.vendor_gst_hst_number) !== taxNumber(vendor.gst_hst_number)) {
    flags.push({
      check_code: "vendor_tax_number_mismatch",
      category: "vendor",
      severity: "warning",
      message: `GST/HST number on the invoice (${d.vendor_gst_hst_number}) differs from the vendor master (${vendor.gst_hst_number}).`,
      evidence: { expected: vendor.gst_hst_number, found: d.vendor_gst_hst_number },
    });
  }

  // Lookalike: this vendor's name reads the same as an established vendor's once cleaned,
  // and this one has fewer past invoices (the established vendor's own invoices are not flagged).
  const others = await query<Vendor & { n: number }>(
    "SELECT v.*, (SELECT count(*) FROM invoices i WHERE i.vendor_id=v.vendor_id)::int AS n FROM vendors v WHERE v.organization_id=$1 AND v.vendor_id<>$2",
    [ctx.organizationId, vendor.vendor_id],
    ctx.db,
  );
  const mine = await query<{ n: number }>("SELECT count(*)::int AS n FROM invoices WHERE vendor_id=$1", [vendor.vendor_id], ctx.db);
  const base = (s: string) => vendorName(s).replace(/ (inc|ltd|llp)$/, "");
  for (const o of others) {
    if (base(o.legal_name) === base(vendor.legal_name) && (mine[0]?.n ?? 0) < o.n) {
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
