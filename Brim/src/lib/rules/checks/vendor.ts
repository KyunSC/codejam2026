/**
 * Vendor checks (BUILD_PLAN Checks): unknown, pending, on hold, new, lookalike, tax number mismatch.
 */
import { config } from "../../config";
import type { VendorRow } from "../../dataset";
import type { Flag } from "../../types";
import { ev, makeFlag } from "../format";
import { idKey, normalizeName } from "../keys";
import type { Refs } from "../refs";
import { type Check, isUnusable } from "./reading";

const APPROVED_STATES = new Set(["approved", "scheduled", "released", "paid"]);

const vendorOf = (vendorId: string | null, refs: Refs) => (vendorId ? refs.vendors.get(vendorId) : undefined);
const src = (v: VendorRow) => `vendors.csv ${v.vendorId}`;

/** VENDOR_UNKNOWN: no vendor record resolved; the closest names are offered, never chosen. */
export const checkVendorUnknown: Check = (inv, refs) => {
  if (inv.vendorId || isUnusable(inv)) return [];
  const offered = inv.vendorCandidates.map((id) => `${id} ${refs.vendors.get(id)?.legalName ?? ""}`.trim());
  return [
    makeFlag(
      "VENDOR_UNKNOWN",
      "policy",
      "hold",
      `"${inv.vendorName ?? "(no name)"}" matches no vendor record by tax number, bank account or name.` +
        (offered.length ? ` Closest records: ${offered.join("; ")}.` : " Onboard the vendor or pick the right record."),
      [
        ev("Vendor name", inv.vendorName, "invoice"),
        ev("GST/HST number", inv.gstHstNumber, "invoice"),
        ev("Closest records", offered.join("; ") || null, "vendors.csv, by name"),
      ],
      offered.length ? { vendorIds: inv.vendorCandidates } : undefined,
    ),
  ];
};

/** VENDOR_PENDING: the vendor is still awaiting approval (pending_review); P05 adds a finance manager step. */
export const checkVendorPending: Check = (inv, refs) => {
  const v = vendorOf(inv.vendorId, refs);
  if (v?.status !== "pending_review") return [];
  return [
    makeFlag(
      "VENDOR_PENDING",
      "policy",
      "hold",
      `${v.legalName} (${v.vendorId}) is pending review: it can be coded and reviewed but not paid until a finance manager or controller approves the vendor.`,
      [ev("Vendor status", v.status, src(v))],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

/** VENDOR_ON_HOLD: the vendor is on hold; only a finance manager or controller may clear it. */
export const checkVendorOnHold: Check = (inv, refs) => {
  const v = vendorOf(inv.vendorId, refs);
  if (v?.status !== "on_hold") return [];
  return [
    makeFlag(
      "VENDOR_ON_HOLD",
      "fraud",
      "hold",
      `${v.legalName} (${v.vendorId}) is on hold; nothing may be paid to it until a finance manager or controller releases the hold.`,
      [ev("Vendor status", v.status, src(v))],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

/** VENDOR_NEW: the vendor has no approved invoice yet; P05 adds a finance manager step. */
export const checkVendorNew: Check = (inv, refs) => {
  const v = vendorOf(inv.vendorId, refs);
  if (!v) return [];
  const past = refs.invoicesByVendor.get(v.vendorId) ?? [];
  if (past.some((i) => APPROVED_STATES.has(i.status))) return [];
  return [
    makeFlag(
      "VENDOR_NEW",
      "policy",
      "route",
      `${v.legalName} (${v.vendorId}) has no approved invoice yet (${past.length} on file), so a finance manager approves this one too.`,
      [ev("Approved invoices from this vendor", 0, "invoice history"), ev("Onboarded", v.onboardedAt, src(v))],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

/**
 * Pairs of vendor records with the same normalised name and a different tax number or bank account.
 * Returned once per pair, lower id first.
 */
export function lookalikePairs(vendors: readonly VendorRow[]): Array<[VendorRow, VendorRow]> {
  const out: Array<[VendorRow, VendorRow]> = [];
  for (let i = 0; i < vendors.length; i++) {
    for (let j = i + 1; j < vendors.length; j++) {
      const a = vendors[i];
      const b = vendors[j];
      if (!normalizeName(a.legalName) || normalizeName(a.legalName) !== normalizeName(b.legalName)) continue;
      const taxDiffers = idKey(a.gstHstNumber) !== idKey(b.gstHstNumber);
      const bankDiffers = idKey(a.bankAccount) !== idKey(b.bankAccount);
      if (taxDiffers || bankDiffers) out.push(a.vendorId < b.vendorId ? [a, b] : [b, a]);
    }
  }
  return out;
}

/** The records a vendor is a lookalike of (same normalised name, different tax number or bank). */
export function lookalikesOf(vendorId: string, refs: Pick<Refs, "vendorList">): VendorRow[] {
  return lookalikePairs(refs.vendorList)
    .filter(([a, b]) => a.vendorId === vendorId || b.vendorId === vendorId)
    .map(([a, b]) => (a.vendorId === vendorId ? b : a));
}

/**
 * VENDOR_LOOKALIKE: another record has the same name but a different tax number or bank account, and
 * this vendor is the one with little or no history, so the invoice may come from an impostor record.
 */
export const checkVendorLookalike: Check = (inv, refs) => {
  const v = vendorOf(inv.vendorId, refs);
  if (!v) return [];
  const mine = (refs.invoicesByVendor.get(v.vendorId) ?? []).length;
  if (mine > config.checks.lookalikeMaxHistory) return [];
  const flags: Flag[] = [];
  for (const other of lookalikesOf(v.vendorId, refs)) {
    const theirs = (refs.invoicesByVendor.get(other.vendorId) ?? []).length;
    if (mine > theirs) continue;
    const diffs = [
      idKey(v.gstHstNumber) !== idKey(other.gstHstNumber) ? "tax number" : null,
      idKey(v.bankAccount) !== idKey(other.bankAccount) ? "bank account" : null,
    ].filter(Boolean);
    flags.push(
      makeFlag(
        "VENDOR_LOOKALIKE",
        "fraud",
        "hold",
        `${v.legalName} (${v.vendorId}, ${mine} past invoices) has the same name as ${other.legalName} (${other.vendorId}, ${theirs} past invoices) but a different ${diffs.join(" and ")}. Confirm which company this invoice is from.`,
        [
          ev("This vendor", `${v.vendorId} ${v.legalName}, tax ${v.gstHstNumber ?? "none"}, bank …${v.bankAccount?.slice(-4) ?? "none"}`, src(v)),
          ev("Lookalike", `${other.vendorId} ${other.legalName}, tax ${other.gstHstNumber ?? "none"}, bank …${other.bankAccount?.slice(-4) ?? "none"}`, src(other)),
        ],
        { vendorIds: [v.vendorId, other.vendorId] },
      ),
    );
  }
  return flags;
};

/** TAX_NUMBER_MISMATCH: the vendor was found by name or bank, and the tax number printed differs from its record. */
export const checkTaxNumberMismatch: Check = (inv, refs) => {
  const v = vendorOf(inv.vendorId, refs);
  if (!v || inv.vendorMatchedBy === "tax_number") return [];
  const printed = idKey(inv.gstHstNumber);
  const onFile = idKey(v.gstHstNumber);
  if (!printed || !onFile || printed === onFile) return [];
  return [
    makeFlag(
      "TAX_NUMBER_MISMATCH",
      "fraud",
      "hold",
      `The invoice names ${v.legalName} but prints GST/HST number ${inv.gstHstNumber}; the number on file for ${v.vendorId} is ${v.gstHstNumber}.`,
      [ev("Printed GST/HST number", inv.gstHstNumber, "invoice"), ev("GST/HST number on file", v.gstHstNumber, src(v))],
      { vendorIds: [v.vendorId] },
    ),
  ];
};

export const VENDOR_CHECKS: Record<string, Check> = {
  VENDOR_UNKNOWN: checkVendorUnknown,
  VENDOR_PENDING: checkVendorPending,
  VENDOR_ON_HOLD: checkVendorOnHold,
  VENDOR_NEW: checkVendorNew,
  VENDOR_LOOKALIKE: checkVendorLookalike,
  TAX_NUMBER_MISMATCH: checkTaxNumberMismatch,
};
