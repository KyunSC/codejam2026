/**
 * PO checks (BUILD_PLAN Checks; policy P12 and P13). PO amounts are pre-tax, so balances compare
 * subtotals.
 */
import type { PurchaseOrderRow } from "../../dataset";
import type { ResolvedInvoice } from "../../types";
import { ev, makeFlag, money } from "../format";
import type { Refs } from "../refs";
import { findPo, invoicesOnPo, poRemaining } from "../resolve/fields";
import type { Check } from "./reading";

const poOf = (inv: ResolvedInvoice, refs: Refs): PurchaseOrderRow | null =>
  (inv.poId ? refs.purchaseOrders.get(inv.poId) : null) ?? findPo(inv.poNumber, refs);

/** PO_REQUIRED_MISSING (P13): the vendor requires a PO and none is printed; open POs that fit are suggested. */
export const checkPoRequiredMissing: Check = (inv, refs) => {
  const v = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  if (!v?.requiresPo || inv.poNumber || inv.poId || inv.kind === "credit_note") return [];
  const fits = inv.poSuggestions;
  return [
    makeFlag(
      "PO_REQUIRED_MISSING",
      "policy",
      "hold",
      `${v.legalName} requires a purchase order, but none is printed on this invoice. ` +
        (fits.length
          ? `Open PO${fits.length > 1 ? "s" : ""} with enough balance for the ${money(inv.subtotal, inv.currency)} subtotal: ${fits.join(", ")}.`
          : `No open PO from this vendor has ${money(inv.subtotal, inv.currency)} left.`),
      [ev("Requires a PO", "yes", `vendors.csv ${v.vendorId}`), ev("PO on the invoice", null, "invoice"), ev("Open POs that fit", fits.join(", ") || null, "purchase_orders.csv")],
      fits.length ? { poIds: fits } : undefined,
    ),
  ];
};

/** PO_NOT_FOUND: the PO number printed on the invoice matches no purchase order. */
export const checkPoNotFound: Check = (inv, refs) => {
  if (!inv.poNumber || poOf(inv, refs)) return [];
  return [
    makeFlag("PO_NOT_FOUND", "policy", "hold", `The invoice cites PO "${inv.poNumber}", which matches no purchase order on file.`, [
      ev("PO on the invoice", inv.poNumber, "invoice"),
      ev("Matching PO", null, "purchase_orders.csv"),
    ]),
  ];
};

/** PO_VENDOR_MISMATCH: the PO cited belongs to another vendor. */
export const checkPoVendorMismatch: Check = (inv, refs) => {
  const po = poOf(inv, refs);
  if (!po || !inv.vendorId || po.vendorId === inv.vendorId) return [];
  const owner = refs.vendors.get(po.vendorId);
  return [
    makeFlag(
      "PO_VENDOR_MISMATCH",
      "policy",
      "hold",
      `PO ${po.poId} was issued to ${owner?.legalName ?? po.vendorId} (${po.vendorId}), not to this invoice's vendor (${inv.vendorId}).`,
      [ev("PO vendor", po.vendorId, `purchase_orders.csv ${po.poId}`), ev("Invoice vendor", inv.vendorId, "resolution")],
      { poIds: [po.poId], vendorIds: [po.vendorId, inv.vendorId] },
    ),
  ];
};

/** PO_CLOSED: the PO cited is closed, so nothing more may be billed against it. */
export const checkPoClosed: Check = (inv, refs) => {
  const po = poOf(inv, refs);
  if (po?.status !== "closed") return [];
  return [
    makeFlag("PO_CLOSED", "policy", "hold", `PO ${po.poId} is closed; nothing more can be billed against it.`, [ev("PO status", po.status, `purchase_orders.csv ${po.poId}`)], {
      poIds: [po.poId],
    }),
  ];
};

/** PO_OVER_BALANCE (P12): the subtotal exceeds what is left on the PO after earlier invoices; a finance manager approves. */
export const checkPoOverBalance: Check = (inv, refs) => {
  const po = poOf(inv, refs);
  if (!po || !inv.subtotal || inv.kind === "credit_note") return [];
  if (inv.vendorId && po.vendorId !== inv.vendorId) return [];
  const left = poRemaining(po, refs);
  if (inv.subtotal.lte(left)) return [];
  const earlier = invoicesOnPo(po.poId, refs);
  return [
    makeFlag(
      "PO_OVER_BALANCE",
      "policy",
      "route",
      `The subtotal ${money(inv.subtotal, inv.currency)} is more than the ${money(left)} left on ${po.poId} (PO ${money(po.totalAmount)}` +
        (earlier.length ? `, already invoiced ${earlier.map((e) => `${e.invoiceId} ${money(e.subtotal)}`).join(", ")}` : "") +
        `). A finance manager must approve the difference of ${money(inv.subtotal.minus(left))}.`,
      [ev("Invoice subtotal", money(inv.subtotal, inv.currency), "invoice"), ev("PO remaining", money(left), `purchase_orders.csv ${po.poId} less earlier invoices`)],
      { poIds: [po.poId], invoiceIds: earlier.map((e) => e.invoiceId) },
    ),
  ];
};

export const PO_CHECKS: Record<string, Check> = {
  PO_REQUIRED_MISSING: checkPoRequiredMissing,
  PO_NOT_FOUND: checkPoNotFound,
  PO_VENDOR_MISMATCH: checkPoVendorMismatch,
  PO_CLOSED: checkPoClosed,
  PO_OVER_BALANCE: checkPoOverBalance,
};
