import { query, one, type Db } from "@/lib/db";
import { subjectOf, type Facts, type Policy, type Subject } from "@/lib/policies";

// The organization's active policies that test an invoice, or a payment.
export async function activePolicies(db: Db, organizationId: string, subject: Subject) {
  const rows = await query<Policy>(
    "SELECT rule_id, rule_type, field, operator, value, required, is_active FROM approval_policies WHERE organization_id=$1 AND is_active ORDER BY rule_id",
    [organizationId],
    db,
  );
  return rows.filter((p) => subjectOf(p) === subject);
}

// What invoice policies test, from the invoice and the flags its checks raised. A split invoice counts at its combined total;
// a vendor with no other invoice is new.
export async function invoiceFacts(
  db: Db,
  inv: { total_cad: number | null; vendor_id: string | null; invoice_id: string | null },
  flags: { check_code: string; evidence?: Record<string, unknown> | null }[],
): Promise<Facts> {
  const vendor = inv.vendor_id
    ? await one<{ status: string; category: string | null; other: number }>(
        "SELECT status, category, (SELECT count(*)::int FROM invoices i WHERE i.vendor_id=v.vendor_id AND i.invoice_id IS DISTINCT FROM $2) AS other FROM vendors v WHERE vendor_id=$1",
        [inv.vendor_id, inv.invoice_id],
        db,
      )
    : null;
  return {
    any_invoice: true,
    invoice_total: Math.max(Math.abs(inv.total_cad ?? 0), ...flags.filter((f) => f.check_code === "split_invoice").map((f) => Number(f.evidence?.combined ?? 0))),
    vendor_status: vendor ? [vendor.status, ...(vendor.other === 0 ? ["new"] : [])] : [],
    vendor_category: vendor?.category ? [vendor.category] : [],
    po_over_balance: flags.some((f) => f.check_code === "po_over_balance"),
    po_missing: flags.some((f) => f.check_code === "po_missing"),
  };
}
