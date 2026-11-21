/**
 * Duplicate detection (BUILD_PLAN "Duplicate detection"). Runs against every known invoice, whatever
 * its state (history and the earlier part of the batch), and against employee-card charges.
 * Lookalike vendor records count as one vendor here. Date is deliberately not compared for DUP_EXACT:
 * two of the three unsealed duplicates carry a new date. Same vendor + same total alone is never a
 * duplicate: fixed-fee vendors bill the same amount every month (BUILD_PLAN "Trap").
 *
 * DUP_FILE (same SHA-256) is handled at intake: the second arrival is never created.
 */
import Decimal from "decimal.js";
import { config } from "../../config";
import { addDays, daysBetween } from "../../today";
import type { Flag, FlagCode, ResolvedInvoice } from "../../types";
import { ev, makeFlag, money } from "../format";
import { idKey, merchantDescriptor } from "../keys";
import type { KnownInvoice, Refs } from "../refs";
import type { Check } from "./reading";
import { lookalikesOf } from "./vendor";

/** This vendor plus any lookalike records of it. */
export function vendorGroup(vendorId: string, refs: Refs): string[] {
  return [vendorId, ...lookalikesOf(vendorId, refs).map((v) => v.vendorId)];
}

function candidates(inv: ResolvedInvoice, refs: Refs): KnownInvoice[] {
  if (!inv.vendorId) return [];
  return vendorGroup(inv.vendorId, refs).flatMap((v) => refs.invoicesByVendor.get(v) ?? []);
}

/** How the suspected original was paid, for the side-by-side review. */
function paidHow(orig: KnownInvoice, refs: Refs): string {
  const pays = refs.paymentsByInvoice.get(orig.invoiceId) ?? [];
  if (!pays.length) return orig.status;
  return `${orig.status}; ${pays.map((p) => `${p.method} ${money(p.amount, p.currency)} ${p.status}${p.paidDate ? ` ${p.paidDate}` : ` for ${p.scheduledDate}`}`).join(", ")}`;
}

function dupFlag(code: FlagCode, inv: ResolvedInvoice, orig: KnownInvoice, why: string, refs: Refs): Flag {
  return makeFlag(
    code,
    "fraud",
    "hold",
    `Possible duplicate of ${orig.invoiceId}: ${why}. The original is ${paidHow(orig, refs)}.`,
    [
      ev("This invoice", `${inv.invoiceNumber ?? "(no number)"}, ${inv.invoiceDate ?? "?"}, ${money(inv.total, inv.currency)}`, "invoice"),
      ev("Suspected original", `${orig.invoiceNumber ?? "(no number)"}, ${orig.invoiceDate ?? "?"}, ${money(orig.total, orig.currency)}, ${paidHow(orig, refs)}`, `invoice ${orig.invoiceId}`),
    ],
    { invoiceIds: [orig.invoiceId], vendorIds: orig.vendorId && orig.vendorId !== inv.vendorId ? [orig.vendorId] : undefined },
  );
}

const samePrinted = (a: string | null, b: string | null) => !!idKey(a) && idKey(a) === idKey(b);
const totalsClose = (a: Decimal | null, b: Decimal | null) =>
  !!a && !!b && a.minus(b).abs().lte(config.duplicates.nearTotalTolerance);

/** DUP_EXACT: the same vendor already has an invoice with this number, printed the same way (date not compared). */
export const checkDupExact: Check = (inv, refs) => {
  if (!inv.numberKey) return [];
  return candidates(inv, refs)
    .filter((k) => k.numberKey === inv.numberKey && samePrinted(k.invoiceNumber, inv.invoiceNumber) && k.kind === inv.kind)
    .map((k) =>
      dupFlag("DUP_EXACT", inv, k, `same vendor and invoice number ${inv.invoiceNumber}${k.invoiceDate !== inv.invoiceDate ? ` (dated ${k.invoiceDate}, now ${inv.invoiceDate})` : ""}`, refs),
    );
};

/**
 * DUP_NEAR: the same number reformatted: the same digits (leading zeros, prefixes and suffixes aside) and a
 * total within $1, e.g. `000604` / `604` or `FA-001655` / `1655-A`.
 */
export const checkDupNear: Check = (inv, refs) => {
  if (!inv.digitsKey) return [];
  return candidates(inv, refs)
    .filter(
      (k) =>
        k.kind === inv.kind &&
        !samePrinted(k.invoiceNumber, inv.invoiceNumber) &&
        k.digitsKey === inv.digitsKey &&
        (k.numberKey === inv.numberKey || totalsClose(k.total, inv.total)),
    )
    .map((k) => dupFlag("DUP_NEAR", inv, k, `invoice number ${inv.invoiceNumber} looks like ${k.invoiceNumber} reformatted, and the totals are ${money(inv.total, inv.currency)} and ${money(k.total, k.currency)}`, refs));
};

const amountsKey = (amounts: Array<Decimal | null>) =>
  amounts
    .map((a) => (a ? a.toFixed(2) : "?"))
    .sort()
    .join("|");

/** Two keys name the same number only when both are present (two missing numbers are not the same number). */
const sameKey = (a: string | null, b: string | null) => !!a && a === b;

/** DUP_CONTENT: a different number, but the same total, dates within a few days and the same set of line amounts. */
export const checkDupContent: Check = (inv, refs) => {
  if (!inv.total || !inv.invoiceDate || !inv.lines.length) return [];
  const mine = amountsKey(inv.lines.map((l) => l.amount));
  return candidates(inv, refs)
    .filter(
      (k) =>
        k.kind === inv.kind &&
        !sameKey(k.numberKey, inv.numberKey) &&
        !sameKey(k.digitsKey, inv.digitsKey) &&
        k.total?.equals(inv.total!) &&
        k.invoiceDate &&
        Math.abs(daysBetween(k.invoiceDate, inv.invoiceDate!)) <= config.duplicates.contentDateWindowDays &&
        k.lines.length === inv.lines.length &&
        amountsKey(k.lines.map((l) => l.amount)) === mine,
    )
    .map((k) => dupFlag("DUP_CONTENT", inv, k, `a different number (${inv.invoiceNumber} vs ${k.invoiceNumber}) but the same total, the same ${inv.lines.length} line amounts, and dates ${k.invoiceDate} and ${inv.invoiceDate}`, refs));
};

type CardTxn = Refs["cardTransactions"][number];

/** Whether a card charge could be the payment of an invoice: amount equal, posted within the window. */
function cardMatches(
  t: CardTxn,
  x: { total: Decimal | null; totalCad: Decimal | null; currency: string | null; invoiceDate: string | null },
): boolean {
  if (!x.total || !x.invoiceDate) return false;
  const from = addDays(x.invoiceDate, -config.duplicates.cardDaysBefore);
  const to = addDays(x.invoiceDate, config.duplicates.cardDaysAfter);
  if (t.postedDate < from || t.postedDate > to) return false;
  return (t.currency === x.currency && t.amount.equals(x.total)) || (!!x.totalCad && t.amountCad.equals(x.totalCad));
}

/**
 * DUP_PAID_BY_CARD: an employee-card charge at this vendor (merchant = the vendor's name upper-cased and
 * cut to the card network's length) for exactly the invoice total, posted from a few days before to
 * several weeks after the invoice date. The invoice may already have been paid on a card. A charge that
 * already matches an earlier invoice is that invoice's, not this one's (one charge pays one invoice).
 */
export const checkDupPaidByCard: Check = (inv, refs) => {
  if (!inv.vendorId || !inv.total || !inv.invoiceDate) return [];
  const names = new Set(
    vendorGroup(inv.vendorId, refs).map((id) => merchantDescriptor(refs.vendors.get(id)!.legalName, config.duplicates.cardMerchantMaxLen)),
  );
  const earlier = candidates(inv, refs);
  return refs.cardTransactions
    .filter(
      (t) =>
        t.source === "employee_card" &&
        names.has(t.merchantDescriptor.trim().toUpperCase()) &&
        cardMatches(t, { total: inv.total, totalCad: inv.totalCad, currency: inv.currencyResolved, invoiceDate: inv.invoiceDate }) &&
        !earlier.some((k) => cardMatches(t, k)),
    )
    .map((t) => {
      const holder = refs.users.get(t.cardholderUserId);
      return makeFlag(
        "DUP_PAID_BY_CARD",
        "fraud",
        "hold",
        `${holder?.fullName ?? t.cardholderUserId} charged ${money(t.amount, t.currency)} at ${t.merchantDescriptor} on their card on ${t.postedDate}, ${daysBetween(inv.invoiceDate!, t.postedDate)} days after this invoice dated ${inv.invoiceDate} for the same amount. It may already be paid.`,
        [ev("Invoice total", money(inv.total, inv.currency), "invoice"), ev("Card charge", `${money(t.amount, t.currency)} on ${t.postedDate} by ${t.cardholderUserId}`, `card_transactions ${t.txnId}`)],
        { cardTxnIds: [t.txnId] },
      );
    });
};

export const DUP_CHECKS: Record<string, Check> = {
  DUP_EXACT: checkDupExact,
  DUP_NEAR: checkDupNear,
  DUP_CONTENT: checkDupContent,
  DUP_PAID_BY_CARD: checkDupPaidByCard,
};
