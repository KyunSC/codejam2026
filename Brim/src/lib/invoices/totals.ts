/**
 * The invoice form's "Calculate totals": line amounts, subtotal, taxes and total from what was typed.
 * Pure and client-safe. Money is rounded to cents, half up, with decimal.js (no float drift).
 *
 * Taxes follow Canadian practice: GST/HST and PST/QST are each charged on the pre-tax subtotal
 * (QST has not been charged on GST since 2013), so total = subtotal + GST/HST + PST/QST.
 */
import Decimal from "decimal.js";

/** A way an invoice is taxed, built from the organization's tax codes. */
export interface TaxChoice {
  id: string;
  label: string;
  /** Rate of the GST/HST part, e.g. 0.13 for Ontario HST. */
  gstHstRate: string;
  /** Rate of the PST/QST part, e.g. 0.09975 for Quebec QST. */
  pstQstRate: string;
}

/** A typed number, or null when blank or not a number. Ignores $, commas and spaces. */
export function parseMoney(v: string): Decimal | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

const cents = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** quantity × unit price to the cent, or null if either is missing. */
export function lineAmount(quantity: string, unitPrice: string): string | null {
  const q = parseMoney(quantity);
  const p = parseMoney(unitPrice);
  return q && p ? cents(q.times(p)).toFixed(2) : null;
}

export interface Totals {
  subtotal: string;
  gstHst: string;
  pstQst: string;
  total: string;
}

/** Subtotal from the line amounts, each tax on the subtotal, and the total. */
export function computeTotals(amounts: readonly string[], tax: Pick<TaxChoice, "gstHstRate" | "pstQstRate"> | null): Totals {
  const subtotal = cents(amounts.reduce((sum, a) => sum.plus(parseMoney(a) ?? 0), new Decimal(0)));
  const gstHst = cents(subtotal.times(tax?.gstHstRate ?? 0));
  const pstQst = cents(subtotal.times(tax?.pstQstRate ?? 0));
  return {
    subtotal: subtotal.toFixed(2),
    gstHst: gstHst.toFixed(2),
    pstQst: pstQst.toFixed(2),
    total: subtotal.plus(gstHst).plus(pstQst).toFixed(2),
  };
}

/**
 * The tax choices offered on the form, from the organization's tax codes (HST13, GST5, PST7_BC,
 * QST9975, EXEMPT, FOREIGN). Combinations are built only from codes that exist.
 */
export function taxChoices(codes: readonly { id: string; description: string; rate: string }[]): TaxChoice[] {
  const rate = (id: string) => codes.find((c) => c.id === id)?.rate;
  const pct = (r: string) => `${new Decimal(r).times(100).toDecimalPlaces(3).toString()}%`;
  const out: TaxChoice[] = [];
  const hst = rate("HST13");
  const gst = rate("GST5");
  const pst = rate("PST7_BC");
  const qst = rate("QST9975");
  if (hst) out.push({ id: "HST13", label: `Ontario: HST ${pct(hst)}`, gstHstRate: hst, pstQstRate: "0" });
  if (gst && qst) out.push({ id: "GST5+QST9975", label: `Quebec: GST ${pct(gst)} + QST ${pct(qst)}`, gstHstRate: gst, pstQstRate: qst });
  if (gst && pst) out.push({ id: "GST5+PST7_BC", label: `British Columbia: GST ${pct(gst)} + PST ${pct(pst)}`, gstHstRate: gst, pstQstRate: pst });
  if (gst) out.push({ id: "GST5", label: `Alberta and other GST-only: GST ${pct(gst)}`, gstHstRate: gst, pstQstRate: "0" });
  if (codes.some((c) => c.id === "EXEMPT")) out.push({ id: "EXEMPT", label: "Exempt: no tax", gstHstRate: "0", pstQstRate: "0" });
  if (codes.some((c) => c.id === "FOREIGN")) out.push({ id: "FOREIGN", label: "Foreign vendor: no Canadian tax", gstHstRate: "0", pstQstRate: "0" });
  return out;
}
