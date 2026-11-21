/**
 * Bank-detail checks (BUILD_PLAN Checks; fraud bonus reuses them): bank details on the document vs the
 * master, an unverified latest bank change, a bank change shortly before the invoice.
 */
import { config } from "../../config";
import type { BankChangeRow } from "../../dataset";
import { addDays } from "../../today";
import type { ResolvedInvoice } from "../../types";
import { ev, makeFlag } from "../format";
import { idKey } from "../keys";
import { isDiscarded, type Refs } from "../refs";
import type { Check } from "./reading";

const last4 = (s: string | null | undefined) => (s ? `…${s.slice(-4)}` : "none");

/** BANK_MISMATCH: the remittance details printed on the invoice differ from the vendor's account on file. */
export const checkBankMismatch: Check = (inv, refs) => {
  const v = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  const printed = idKey(inv.remit.account);
  if (!v || !printed) return [];
  const diffs: string[] = [];
  if (printed !== idKey(v.bankAccount)) diffs.push("account");
  if (idKey(inv.remit.transit) && idKey(inv.remit.transit) !== idKey(v.bankTransit)) diffs.push("transit");
  if (idKey(inv.remit.institution) && idKey(inv.remit.institution) !== idKey(v.bankInstitution)) diffs.push("institution");
  if (!diffs.length) return [];
  const doc = `inst. ${inv.remit.institution ?? "?"} transit ${inv.remit.transit ?? "?"} acct ${last4(inv.remit.account)}`;
  const file = v.bankAccount ? `inst. ${v.bankInstitution} transit ${v.bankTransit} acct ${last4(v.bankAccount)}` : "no bank details";
  return [
    makeFlag(
      "BANK_MISMATCH",
      "fraud",
      "hold",
      `The invoice asks for payment to ${doc}, but ${v.legalName} (${v.vendorId}) has ${file} on file (${diffs.join(", ")} differ${diffs.length === 1 ? "s" : ""}). Verify with the vendor on the number already on file before paying.`,
      [ev("Bank details on the invoice", doc, "invoice, remittance"), ev("Bank details on file", file, `vendors.csv ${v.vendorId}`)],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

/** The vendor's bank changes on or before `asOf`, oldest first. */
export function bankChangesAsOf(vendorId: string, asOf: string, refs: Pick<Refs, "bankChangesByVendor">): BankChangeRow[] {
  return (refs.bankChangesByVendor.get(vendorId) ?? []).filter((c) => c.changedAt <= asOf);
}

/**
 * BANK_CHANGE_UNVERIFIED: the vendor's latest bank change was never verified by a callback, so any
 * payment to the new account is held. An existing invoice is not affected when it was discarded (it will
 * not be paid) or its payment was already scheduled before the change.
 */
export const checkBankChangeUnverified: Check = (inv, refs) => {
  if (!inv.vendorId) return [];
  const changes = bankChangesAsOf(inv.vendorId, refs.today, refs);
  const latest = changes[changes.length - 1];
  if (!latest || latest.verifiedByCallback) return [];
  if (refs.self) {
    if (isDiscarded(refs.self.status)) return [];
    const inMotion = (refs.paymentsByInvoice.get(refs.self.invoiceId) ?? []).some((p) => p.scheduledDate < latest.changedAt);
    if (inMotion) return [];
  }
  const v = refs.vendors.get(inv.vendorId)!;
  return [
    makeFlag(
      "BANK_CHANGE_UNVERIFIED",
      "fraud",
      "hold",
      `${v.legalName}'s bank account was changed on ${latest.changedAt} (…${latest.oldAccountLast4} → …${latest.newAccountLast4}) by ${latest.requestChannel.replace(/_/g, " ")}, and nobody called the vendor back to verify it. Payment is held until a second person verifies the change.`,
      [
        ev("Bank change", `${latest.changeId}: …${latest.oldAccountLast4} → …${latest.newAccountLast4}`, `bank_change_history ${latest.changeId}`),
        ev("Verified by callback", "no", `bank_change_history ${latest.changeId}`),
        ev("Requested via", latest.requestChannel, `bank_change_history ${latest.changeId}`),
      ],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

/** BANK_CHANGE_RECENT: the vendor's bank details changed in the configured number of days before the invoice date. */
export const checkBankChangeRecent: Check = (inv: ResolvedInvoice, refs) => {
  if (!inv.vendorId || !inv.invoiceDate) return [];
  const from = addDays(inv.invoiceDate, -config.checks.bankChangeRecentDays);
  const recent = (refs.bankChangesByVendor.get(inv.vendorId) ?? []).filter((c) => c.changedAt >= from && c.changedAt <= inv.invoiceDate!);
  return recent.map((c) =>
    makeFlag(
      "BANK_CHANGE_RECENT",
      "fraud",
      "info",
      `The vendor's bank account changed on ${c.changedAt} (…${c.oldAccountLast4} → …${c.newAccountLast4}), within ${config.checks.bankChangeRecentDays} days before this invoice dated ${inv.invoiceDate}${c.verifiedByCallback ? "; the change was verified by callback" : ""}.`,
      [ev("Bank change", `${c.changeId} on ${c.changedAt}`, `bank_change_history ${c.changeId}`), ev("Invoice date", inv.invoiceDate, "invoice")],
      { vendorIds: [inv.vendorId!] },
    ),
  );
};

export const BANK_CHECKS: Record<string, Check> = {
  BANK_MISMATCH: checkBankMismatch,
  BANK_CHANGE_UNVERIFIED: checkBankChangeUnverified,
  BANK_CHANGE_RECENT: checkBankChangeRecent,
};
