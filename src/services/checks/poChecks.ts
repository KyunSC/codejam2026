import { one } from "@/lib/db";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

export async function poChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor, db } = ctx;
  const flags: Flag[] = [];
  if (!d.po_id) {
    if (vendor?.requires_po) {
      const candidates = d.po_candidates?.length ? ` Open purchase orders for this vendor: ${d.po_candidates.join(", ")}.` : " The vendor has no open purchase order.";
      flags.push({ check_code: "po_missing", category: "po", severity: "warning", message: `${vendor.legal_name} requires a purchase order and none is on the invoice.${candidates}` });
    }
    if (d.po_reference) {
      flags.push({ check_code: "po_not_found", category: "po", severity: "blocking", message: `Purchase order "${d.po_reference}" printed on the invoice does not exist.` });
    }
    return flags;
  }
  const po = await one<{ po_id: string; vendor_id: string; total_amount: number; status: string; requester_user_id: string | null; requester_status: string | null }>(
    `SELECT p.*, u.status AS requester_status FROM purchase_orders p LEFT JOIN users u ON u.user_id = p.requester_user_id WHERE p.po_id=$1`,
    [d.po_id],
    db,
  );
  if (!po) return flags;
  if (vendor && po.vendor_id !== vendor.vendor_id) {
    flags.push({ check_code: "po_other_vendor", category: "po", severity: "blocking", message: `${po.po_id} belongs to vendor ${po.vendor_id}, not ${vendor.vendor_id}.` });
  }
  if (po.status === "closed") {
    flags.push({ check_code: "po_closed", category: "po", severity: "warning", message: `${po.po_id} is closed.` });
  }
  const billed = await one<{ s: number }>(
    "SELECT COALESCE(SUM(subtotal),0) AS s FROM invoices WHERE po_id=$1 AND status NOT IN ('rejected','void')",
    [po.po_id],
    db,
  );
  const remaining = po.total_amount - (billed?.s ?? 0);
  if ((d.subtotal ?? 0) > remaining + 0.005) {
    flags.push({
      check_code: "po_over_balance",
      category: "po",
      severity: "warning",
      message: `Subtotal ${money(d.subtotal)} is above ${po.po_id}'s remaining balance of ${money(remaining)}.`,
      evidence: { expected: remaining, found: d.subtotal },
    });
  }
  if (po.requester_status === "terminated") {
    flags.push({ check_code: "po_requester_terminated", category: "po", severity: "warning", message: `${po.po_id} was requested by ${po.requester_user_id}, who no longer works here.` });
  }
  return flags;
}
