/**
 * Checks on the reading, the arithmetic and the dates (BUILD_PLAN Checks, first rows).
 * Each is one function `(invoice, refs) => Flag[]` with a one-sentence reason above it.
 */
import Decimal from "decimal.js";
import { config } from "../../config";
import { addDays, daysBetween } from "../../today";
import type { Flag, ParseIssue, ResolvedInvoice } from "../../types";
import { ev, makeFlag, money } from "../format";
import type { Refs } from "../refs";
import { resolveFx } from "../resolve/fields";

export type Check = (invoice: ResolvedInvoice, refs: Refs) => Flag[];

/** Fields an invoice cannot be processed without. */
export const REQUIRED_FIELDS = ["vendorName", "invoiceNumber", "invoiceDate", "total"] as const;

const DOC = "invoice";

/** Nothing usable was read: no amounts at all, or none of vendor, number and total. */
export function isUnusable(inv: ResolvedInvoice): boolean {
  const noAmounts = !inv.total && !inv.subtotal && !inv.lines.some((l) => l.amount);
  const noIdentity = !inv.vendorName && !inv.invoiceNumber && !inv.total;
  return noAmounts || noIdentity || inv.extracted?.docType === "other";
}

/** UNREADABLE: the file gave no usable extraction, so nothing else can be checked. */
export const checkUnreadable: Check = (inv) =>
  isUnusable(inv)
    ? [
        makeFlag(
          "UNREADABLE",
          "data",
          "hold",
          "Nothing usable could be read from this file: no amounts, or no vendor, invoice number and total. A person must read it.",
          [
            ev("Vendor name", inv.vendorName, DOC),
            ev("Invoice number", inv.invoiceNumber, DOC),
            ev("Total", inv.total ? money(inv.total, inv.currency) : null, DOC),
            ev("Lines read", inv.lines.length, DOC),
          ],
        ),
      ]
    : [];

const PARSE_ISSUE_TEXT: Record<string, string> = {
  AMOUNT_UNPARSEABLE: "an amount that could not be read as a number",
  DATE_UNPARSEABLE: "a date that could not be read",
  TAX_LABEL_UNKNOWN: "a tax label that matches no known tax, so the tax checks cannot test it",
};

/**
 * FIELD_UNCERTAIN: a required field is missing, unreadable, or two reads of a scan disagree on it; or
 * parsing hit an unreadable amount or date, or an unknown tax label, anywhere on the document (one flag
 * per field; DATE_AMBIGUOUS has its own check).
 */
export const checkFieldUncertain: Check = (inv) => {
  if (isUnusable(inv)) return [];
  const bad = REQUIRED_FIELDS.flatMap((f) => {
    const e = inv.evidence[f];
    if (inv[f] === null || inv[f] === undefined) return [{ f, why: e === "unreadable" ? "unreadable" : "missing" }];
    if (e === "uncertain" || e === "unreadable" || e === "missing") return [{ f, why: e }];
    return [];
  });
  const flagged = new Set<string>(bad.map((b) => b.f));
  const issues: ParseIssue[] = [];
  for (const p of inv.parseIssues) {
    if (p.code === "DATE_AMBIGUOUS" || flagged.has(p.field)) continue;
    flagged.add(p.field);
    issues.push(p);
  }
  const fromIssues = issues.map((p) =>
    makeFlag(
      "FIELD_UNCERTAIN",
      "data",
      "hold",
      `The ${p.field} has ${PARSE_ISSUE_TEXT[p.code]}: "${p.raw}" (${p.detail}). Check it against the document.`,
      [ev(p.field, p.raw, `${DOC}, parse issue ${p.code}`)],
    ),
  );
  return [...bad.map(({ f, why }) =>
    makeFlag(
      "FIELD_UNCERTAIN",
      "data",
      "hold",
      `The ${f} field is ${why === "uncertain" ? "uncertain: two reads of the scan disagree" : why}. Check it against the document.`,
      [ev(f, inv[f] === null || inv[f] === undefined ? null : String(inv[f]), `${DOC}, evidence: ${why}`)],
    ),
  ), ...fromIssues];
};

const tol = () => new Decimal(config.tolerance.arithmeticCad);

/** ARITHMETIC_LINE: quantity × unit price differs from the printed line amount by more than the tolerance. */
export const checkArithmeticLine: Check = (inv) =>
  inv.lines.flatMap((l) => {
    if (!l.quantity || !l.unitPrice || !l.amount) return [];
    const expected = l.quantity.mul(l.unitPrice).toDecimalPlaces(2);
    if (expected.minus(l.amount).abs().lte(tol())) return [];
    return [
      makeFlag(
        "ARITHMETIC_LINE",
        "data",
        "hold",
        `Line ${l.lineNo}: ${l.quantity.toString()} × ${money(l.unitPrice, inv.currency)} is ${money(expected, inv.currency)}, but the line is printed as ${money(l.amount, inv.currency)}.`,
        [
          ev("Quantity × unit price", money(expected, inv.currency), `${DOC}, line ${l.lineNo}`),
          ev("Printed amount", money(l.amount, inv.currency), `${DOC}, line ${l.lineNo}`),
        ],
      ),
    ];
  });

/** ARITHMETIC_SUBTOTAL: the line amounts do not add up to the printed subtotal. */
export const checkArithmeticSubtotal: Check = (inv) => {
  if (!inv.subtotal || !inv.lines.length || inv.lines.some((l) => !l.amount)) return [];
  const sum = inv.lines.reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  if (sum.minus(inv.subtotal).abs().lte(tol())) return [];
  return [
    makeFlag(
      "ARITHMETIC_SUBTOTAL",
      "data",
      "hold",
      `The ${inv.lines.length} lines add up to ${money(sum, inv.currency)}, but the subtotal is printed as ${money(inv.subtotal, inv.currency)}.`,
      [ev("Sum of lines", money(sum, inv.currency), `${DOC}, lines`), ev("Printed subtotal", money(inv.subtotal, inv.currency), `${DOC}, subtotal`)],
    ),
  ];
};

/** ARITHMETIC_TOTAL: subtotal plus the printed taxes differs from the printed total. */
export const checkArithmeticTotal: Check = (inv) => {
  if (!inv.subtotal || !inv.total) return [];
  const taxes = inv.taxes.reduce((s, t) => s.plus(t.amount), new Decimal(0));
  const expected = inv.subtotal.plus(taxes);
  if (expected.minus(inv.total).abs().lte(tol())) return [];
  return [
    makeFlag(
      "ARITHMETIC_TOTAL",
      "data",
      "hold",
      `Subtotal ${money(inv.subtotal, inv.currency)} plus taxes ${money(taxes, inv.currency)} is ${money(expected, inv.currency)}, but the total is printed as ${money(inv.total, inv.currency)}.`,
      [ev("Subtotal + taxes", money(expected, inv.currency), `${DOC}, subtotal and tax lines`), ev("Printed total", money(inv.total, inv.currency), `${DOC}, total`)],
    ),
  ];
};

/**
 * DATE_ODD: the dates do not make sense together: due before the invoice date; invoice dated after it
 * was received (a hold when the date is still in the future); dated more than the configured number of
 * days before it was received; or a due date that is not the invoice date plus the printed terms.
 */
export const checkDateOdd: Check = (inv, refs) => {
  const out: Flag[] = [];
  const { invoiceDate: d, dueDate: due, receivedDate: rec } = inv;
  if (!d) return out;
  if (due && due < d) {
    out.push(
      makeFlag("DATE_ODD", "data", "info", `The due date ${due} is before the invoice date ${d}.`, [
        ev("Invoice date", d, DOC),
        ev("Due date", due, DOC),
      ]),
    );
  }
  if (d > rec) {
    const future = d > refs.today;
    out.push(
      makeFlag(
        "DATE_ODD",
        "data",
        future ? "hold" : "info",
        future
          ? `The invoice is dated ${d}, which is in the future (today is ${refs.today}); it was received ${rec}.`
          : `The invoice is dated ${d}, after the day it was received (${rec}).`,
        [ev("Invoice date", d, DOC), ev("Received", rec, "inbox"), ev("Today", refs.today, "APP_TODAY")],
      ),
    );
  }
  const age = daysBetween(d, rec);
  if (age > config.checks.dateOddMaxAgeDays) {
    out.push(
      makeFlag(
        "DATE_ODD",
        "data",
        "info",
        `The invoice is dated ${d}, ${age} days before it was received on ${rec} (more than ${config.checks.dateOddMaxAgeDays}).`,
        [ev("Invoice date", d, DOC), ev("Received", rec, "inbox")],
      ),
    );
  }
  const net = inv.terms?.netDays;
  if (due && net !== null && net !== undefined && due >= d) {
    const expected = addDays(d, net);
    if (expected !== due) {
      out.push(
        makeFlag(
          "DATE_ODD",
          "data",
          "info",
          `The printed terms "${inv.terms!.raw}" make the invoice due ${expected}, but the due date printed is ${due}.`,
          [ev("Invoice date + terms", expected, `${DOC}, terms "${inv.terms!.raw}"`), ev("Printed due date", due, DOC)],
        ),
      );
    }
  }
  return out;
};

/** DATE_AMBIGUOUS: a printed date reads two ways (e.g. 03/04/2026), so a person must say which. */
export const checkDateAmbiguous: Check = (inv) =>
  inv.parseIssues
    .filter((p) => p.code === "DATE_AMBIGUOUS")
    .map((p) =>
      makeFlag("DATE_AMBIGUOUS", "data", "hold", `The ${p.field} "${p.raw}" can be read two ways: ${p.detail}.`, [
        ev(p.field, p.raw, `${DOC}, as printed`),
      ]),
    );

/** TERMS_MISMATCH: the invoice's payment terms differ from the vendor's terms in the master. */
export const checkTermsMismatch: Check = (inv, refs) => {
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  if (!vendor) return [];
  const printed = inv.terms?.netDays ?? null;
  const days = printed ?? (inv.invoiceDate && inv.dueDate ? daysBetween(inv.invoiceDate, inv.dueDate) : null);
  if (days === null || days === vendor.paymentTermsDays) return [];
  const what = printed !== null ? `prints terms "${inv.terms!.raw}" (${days} days)` : `is due ${days} days after its date`;
  return [
    makeFlag(
      "TERMS_MISMATCH",
      "policy",
      "info",
      `The invoice ${what}; the vendor's terms on file are ${vendor.paymentTermsDays} days.`,
      [ev("Invoice terms (days)", days, printed !== null ? `${DOC}, terms` : `${DOC}, due − invoice date`), ev("Vendor terms (days)", vendor.paymentTermsDays, `vendors.csv ${vendor.vendorId}`)],
    ),
  ];
};

/** FX_RATE_FALLBACK: no FX rate on file covers a USD invoice's date (after the last row or before the first), so the nearest was used. */
export const checkFxRateFallback: Check = (inv, refs) => {
  const fx = resolveFx(inv.currencyResolved, inv.invoiceDate, refs);
  if (!fx.fallback) return [];
  return [
    makeFlag(
      "FX_RATE_FALLBACK",
      "data",
      "info",
      `No USD rate is on file for ${inv.invoiceDate}; the nearest rate, ${fx.rate!.toString()} on ${fx.rateDate}, was used.`,
      [ev("Invoice date", inv.invoiceDate, DOC), ev("Rate used", `${fx.rate!.toString()} (${fx.rateDate})`, "fx_rates.csv, nearest row")],
    ),
  ];
};

/** SHIP_TO_UNKNOWN: the bill-to address is not one of the four offices, so the tax province is unknown. */
export const checkShipToUnknown: Check = (inv) =>
  inv.shipToProvince || isUnusable(inv)
    ? []
    : [
        makeFlag(
          "SHIP_TO_UNKNOWN",
          "data",
          "hold",
          `The bill-to address "${inv.billToAddress ?? "(none)"}" is not one of Harborline's four offices, so the tax province is unknown. Pick the province.`,
          [ev("Bill-to address", inv.billToAddress, `${DOC}, bill-to`)],
        ),
      ];

export const READING_CHECKS: Record<string, Check> = {
  UNREADABLE: checkUnreadable,
  FIELD_UNCERTAIN: checkFieldUncertain,
  ARITHMETIC_LINE: checkArithmeticLine,
  ARITHMETIC_SUBTOTAL: checkArithmeticSubtotal,
  ARITHMETIC_TOTAL: checkArithmeticTotal,
  DATE_ODD: checkDateOdd,
  DATE_AMBIGUOUS: checkDateAmbiguous,
  TERMS_MISMATCH: checkTermsMismatch,
  FX_RATE_FALLBACK: checkFxRateFallback,
  SHIP_TO_UNKNOWN: checkShipToUnknown,
};
