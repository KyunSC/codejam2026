/**
 * People and pattern checks (BUILD_PLAN Checks): split invoices, terminated requester, self-approval
 * (found in history), orphan credit notes.
 */
import Decimal from "decimal.js";
import { config } from "../../config";
import { daysBetween } from "../../today";
import type { ResolvedInvoice } from "../../types";
import { ev, makeFlag, money } from "../format";
import { isDiscarded, type KnownInvoice, type Refs } from "../refs";
import { approvalThresholds } from "../routing/policy";
import type { Check } from "./reading";

export interface SplitGroup {
  threshold: number;
  members: KnownInvoice[];
  combinedCad: Decimal;
}

/** An earlier invoice that is a copy of this one (same number, or same digits and total): a duplicate, not a split. */
function isCopy(k: KnownInvoice, inv: ResolvedInvoice): boolean {
  if (inv.numberKey && k.numberKey === inv.numberKey) return true;
  return !!inv.digitsKey && k.digitsKey === inv.digitsKey && !!k.total && !!inv.total && k.total.minus(inv.total).abs().lte(config.duplicates.nearTotalTolerance);
}

/**
 * The split this invoice completes, if any: earlier invoices from the same vendor (and the same
 * requester, when both are known) dated within the window, every one (and this one) at or under a
 * threshold (the thresholds of the policy rules in force), which together with this invoice go over it.
 * Every part from the one that crosses the threshold on is flagged, so a third or later part is caught
 * too. Discarded invoices (rejected, duplicate, void) and copies of this invoice do not count.
 *
 * Same requester, from PLAN.md ("same vendor + requester"): history's two planted groups are one
 * requester each, and the other same-vendor invoices within 5 days of them have different requesters.
 * Incoming documents name no requester, so an unknown requester matches anyone.
 */
export function findSplit(inv: ResolvedInvoice, refs: Refs): SplitGroup | null {
  if (!inv.vendorId || !inv.invoiceDate || !inv.totalCad || inv.kind === "credit_note") return null;
  const near = (refs.invoicesByVendor.get(inv.vendorId) ?? []).filter(
    (k) =>
      k.kind === "invoice" &&
      !isDiscarded(k.status) &&
      k.invoiceDate &&
      k.totalCad &&
      !isCopy(k, inv) &&
      (!inv.requesterId || !k.requesterId || k.requesterId === inv.requesterId) &&
      Math.abs(daysBetween(k.invoiceDate, inv.invoiceDate!)) <= config.checks.splitWindowDays,
  );
  for (const t of approvalThresholds(refs.policyRules)) {
    if (inv.totalCad.gt(t)) continue;
    const members = near.filter((k) => k.totalCad!.lte(t));
    if (!members.length) continue;
    const combined = members.reduce((s, k) => s.plus(k.totalCad!), new Decimal(inv.totalCad));
    if (combined.gt(t)) return { threshold: t, members, combinedCad: combined };
  }
  return null;
}

/** SPLIT_SUSPECTED: invoices from one vendor within a few days, each under an approval limit, together over it; routed as the combined amount. */
export const checkSplitSuspected: Check = (inv, refs) => {
  const g = findSplit(inv, refs);
  if (!g) return [];
  const all = [...g.members.map((m) => `${m.invoiceId} ${money(m.totalCad)} (${m.invoiceDate})`), `this invoice ${money(inv.totalCad)} (${inv.invoiceDate})`];
  const v = refs.vendors.get(inv.vendorId!);
  return [
    makeFlag(
      "SPLIT_SUSPECTED",
      "policy",
      "route",
      `Possible split: ${all.length} invoices from ${v?.legalName ?? inv.vendorId} within ${config.checks.splitWindowDays} days are each at or under ${money(g.threshold)} but total ${money(g.combinedCad)} together: ${all.join(", ")}. Approval is routed as the combined amount.`,
      [
        ev("Combined total (CAD)", g.combinedCad.toFixed(2), `${all.length} invoices from ${inv.vendorId}`),
        ev("Approval threshold", money(g.threshold), "approval policy"),
      ],
      { invoiceIds: g.members.map((m) => m.invoiceId) },
    ),
  ];
};

/** REQUESTER_TERMINATED: the requester had left the company when the invoice arrived; their manager takes their place. */
export const checkRequesterTerminated: Check = (inv, refs) => {
  const u = inv.requesterId ? refs.users.get(inv.requesterId) : undefined;
  if (u?.status !== "terminated") return [];
  if (u.statusSince && u.statusSince > inv.receivedDate) return [];
  const mgr = u.managerId ? refs.users.get(u.managerId) : undefined;
  return [
    makeFlag(
      "REQUESTER_TERMINATED",
      "policy",
      "info",
      `The requester, ${u.fullName} (${u.userId}), left on ${u.statusSince ?? "an unknown date"}; the request is reassigned to their manager${mgr ? `, ${mgr.fullName} (${mgr.userId})` : ""}.`,
      [ev("Requester status", `${u.status} since ${u.statusSince ?? "?"}`, `users.csv ${u.userId}`), ev("Reassigned to", mgr ? `${mgr.userId} ${mgr.fullName}` : null, `users.csv ${u.userId} manager`)],
    ),
  ];
};

/** SELF_APPROVAL: an approval on record was given by the invoice's own requester (rule 2, P07). */
export const checkSelfApproval: Check = (inv, refs) => {
  if (!refs.self || !inv.requesterId) return [];
  const own = (refs.approvalsByInvoice.get(refs.self.invoiceId) ?? []).filter((a) => a.approverUserId === inv.requesterId && a.action === "approved");
  return own.map((a) => {
    const u = refs.users.get(a.approverUserId);
    return makeFlag(
      "SELF_APPROVAL",
      "fraud",
      "info",
      `${u?.fullName ?? a.approverUserId} (${a.approverUserId}) approved step ${a.stepNo} of an invoice they requested themselves, on ${a.actedAt.slice(0, 10)}; it should have gone to their manager.`,
      [ev("Requester", inv.requesterId, "invoice"), ev("Approver", `${a.approverUserId} (${a.approverRole})`, `approvals.csv ${a.approvalId}`)],
    );
  });
};

/** CREDIT_NOTE_ORPHAN: a credit note whose reference matches none of the vendor's invoices. */
export const checkCreditNoteOrphan: Check = (inv) => {
  if (inv.kind !== "credit_note" || inv.creditOfInvoiceId) return [];
  return [
    makeFlag(
      "CREDIT_NOTE_ORPHAN",
      "policy",
      "hold",
      inv.creditNoteRef
        ? `This credit note refers to invoice "${inv.creditNoteRef}", which matches none of the vendor's invoices on file.`
        : "This credit note does not say which invoice it credits.",
      [ev("Credit note reference", inv.creditNoteRef, "invoice, credit note ref"), ev("Matching invoice", null, `invoice history of ${inv.vendorId ?? "unknown vendor"}`)],
    ),
  ];
};

export const PEOPLE_CHECKS: Record<string, Check> = {
  SPLIT_SUSPECTED: checkSplitSuspected,
  REQUESTER_TERMINATED: checkRequesterTerminated,
  SELF_APPROVAL: checkSelfApproval,
  CREDIT_NOTE_ORPHAN: checkCreditNoteOrphan,
};
