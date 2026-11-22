import { ConflictError, NotFoundError } from "@/lib/errors";
import { tx, query, one } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { InvoiceData, User } from "@/lib/types";
import { getParsed, resolveAndSave } from "./pipeline.service";
import { getRawItem } from "./rawIntake.service";

export type PurchaseOrderChoice = {
  po_id: string; vendor_id: string; vendor_name: string; description: string | null; total_amount: number; currency: string; remaining: number;
  department: string | null; requester: string | null; same_vendor: boolean; fits: boolean;
};

// The organization's purchase orders that are not closed, closest match to the invoice first: the invoice's own vendor's
// before other vendors' (linking one of those raises a blocking flag), then those whose remaining balance covers the
// invoice's subtotal, the smallest leftover first, then those it would overrun, the smallest overrun first.
// The balance leaves out this invoice, so a linked order is measured as if it were not yet billed for it.
export async function purchaseOrderChoices(actor: User | null, organizationId: string, parsedInvoiceId: string): Promise<PurchaseOrderChoice[]> {
  assertCan(actor, "po.manage");
  const p = await getParsed(actor, organizationId, parsedInvoiceId);
  if (!p) throw new NotFoundError("No such invoice");
  const d = p.invoice_json;
  const subtotal = d.subtotal ?? d.total ?? 0;
  const rows = await query<Omit<PurchaseOrderChoice, "same_vendor" | "fits">>(
    `SELECT o.po_id, o.vendor_id, v.legal_name AS vendor_name, o.description, o.total_amount::float, o.currency, dp.name AS department, u.full_name AS requester,
            (o.total_amount - COALESCE((SELECT SUM(i.subtotal) FROM invoices i
               WHERE i.po_id = o.po_id AND i.status NOT IN ('rejected','void') AND i.parsed_invoice_id IS DISTINCT FROM $2), 0))::float AS remaining
       FROM purchase_orders o JOIN vendors v USING (vendor_id)
       LEFT JOIN departments dp ON dp.department_id = o.department_id
       LEFT JOIN users u ON u.user_id = o.requester_user_id
      WHERE v.organization_id=$1 AND (o.status <> 'closed' OR o.po_id = $3)`,
    [organizationId, parsedInvoiceId, d.po_id ?? null],
  );
  const gap = (r: { remaining: number }) => r.remaining - subtotal;
  return rows
    .map((r) => ({ ...r, same_vendor: r.vendor_id === d.vendor_id, fits: gap(r) >= -0.005 }))
    .sort((a, b) =>
      a.same_vendor !== b.same_vendor ? (a.same_vendor ? -1 : 1) : a.fits !== b.fits ? (a.fits ? -1 : 1) : Math.abs(gap(a)) - Math.abs(gap(b)),
    );
}

// Links the invoice to a purchase order, or unlinks it (null), at any stage. The checks are not run; while the invoice is
// under review the clerk runs them again (an order of another vendor is then flagged). A created invoice keeps its
// department and requester; one under review has its links resolved again.
export async function linkPurchaseOrder(actor: User | null, organizationId: string, parsedInvoiceId: string, poId: string | null) {
  assertCan(actor, "po.manage");
  return tx(async (c) => {
    const p = await getParsed(actor, organizationId, parsedInvoiceId, c);
    if (!p) throw new NotFoundError("No such invoice");
    if (p.status === "rejected") throw new ConflictError("The invoice was rejected.");
    const before = p.invoice_json;
    if (poId && !(await one("SELECT 1 FROM purchase_orders o JOIN vendors v USING (vendor_id) WHERE o.po_id=$1 AND v.organization_id=$2", [poId, organizationId], c))) {
      throw new NotFoundError("No such purchase order");
    }
    const d: InvoiceData = structuredClone(before);
    d.po_id = poId;
    d.manual = [...new Set([...(d.manual ?? []), "po_id"])];
    if (p.invoice_id) {
      await query("UPDATE invoices SET po_id=$2 WHERE invoice_id=$1", [p.invoice_id, poId], c);
      await query("UPDATE parsed_invoices SET invoice_json=$2 WHERE parsed_invoice_id=$1", [parsedInvoiceId, JSON.stringify(d)], c);
    } else {
      await resolveAndSave(c, parsedInvoiceId, (await getRawItem(actor, organizationId, p.raw_item_id, c))!, d);
    }
    await writeAudit(c, {
      organizationId, actor, action: "invoice.po_link",
      entityType: p.invoice_id ? "invoice" : "parsed_invoice", entityId: p.invoice_id ?? parsedInvoiceId, invoiceId: p.invoice_id ?? undefined,
      before: { po_id: before.po_id ?? null }, after: { po_id: poId },
    });
  });
}
