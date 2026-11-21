/**
 * Payment terms as printed (BUILD_PLAN "Normalisation", Terms).
 * `Net N` → N days; `Due on receipt` → 0; `2/10 Net 30` → 30 days with 2% off if paid in 10.
 * French forms too (`Net 30 jours`, `30 jours net`, `Payable dès réception`).
 * Unrecognised terms keep the raw text with nulls; the due-date check then has no terms to use.
 */
import Decimal from "decimal.js";
import type { NormalizedTerms } from "../../types";

export function normalizeTerms(raw: string | null | undefined): NormalizedTerms | null {
  if (raw == null || raw.trim() === "") return null;
  const s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const out: NormalizedTerms = { raw, netDays: null, discountPct: null, discountDays: null };

  const discount = /(\d{1,2}(?:[.,]\d+)?)\s*%?\s*\/\s*(\d{1,3})\b/.exec(s);
  if (discount) {
    out.discountPct = new Decimal(discount[1].replace(",", "."));
    out.discountDays = Number(discount[2]);
  }
  if (/\b(due|payable)\b.*\b(on|upon|des|a|sur)\b.*\b(receipt|reception)\b|\bcod\b|\bimmediate/.test(s)) {
    out.netDays = 0;
    return out;
  }
  const rest = discount ? s.slice(discount.index + discount[0].length) : s;
  const net =
    /\bn(?:et)?\s*\/?\s*(\d{1,3})\b/.exec(rest) ??
    /\b(\d{1,3})\s*(?:days?|jours?)\b/.exec(rest) ??
    /\b(?:net|nets?)\b\D*(\d{1,3})\b/.exec(rest);
  if (net) out.netDays = Number(net[1]);
  return out;
}
