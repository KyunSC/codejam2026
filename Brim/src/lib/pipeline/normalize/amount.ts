/**
 * Amounts as printed → Decimal (BUILD_PLAN "Normalisation", Amounts).
 *
 * - `$`, currency codes (`CAD`, `USD`, `CA$`, `US$`) and every kind of space are stripped,
 *   including the no-break and thin spaces French layouts use as thousands separators.
 * - A comma followed by exactly two digits at the end is a decimal comma; any other comma is
 *   a thousands separator. When the comma is the decimal mark, dots are thousands separators.
 * - The sign is kept: a leading or trailing minus, or parentheses, make it negative.
 * - Separators must sit between groups of three digits. Anything else (`12,5`, `1.2.3`, `abc`)
 *   is not guessed at: it raises AMOUNT_UNPARSEABLE.
 */
import Decimal from "decimal.js";
import type { ParseIssue } from "../../types";

export type AmountResult = { ok: true; value: Decimal } | { ok: false; issue: ParseIssue };

const SPACES = /[\s    ']/g; // ' is the Swiss thousands mark; harmless here
const CURRENCY = /\b(CAD|USD)\b|CA\$|US\$|C\$|\$/gi;
const MINUS = /[−–—]/g; // − – — printed as minus

function unparseable(raw: string, field: string, detail: string): AmountResult {
  return { ok: false, issue: { field, code: "AMOUNT_UNPARSEABLE", raw, detail } };
}

/** Removes thousands separators `sep` only where they sit between groups of three digits. */
function dropThousands(intPart: string, sep: string): string | null {
  if (!intPart.includes(sep)) return /^\d+$/.test(intPart) ? intPart : null;
  const groups = intPart.split(sep);
  if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
  return groups.join("");
}

export function parseAmount(raw: string | number | null | undefined, field = "amount"): AmountResult | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: new Decimal(String(raw)) }
      : unparseable(String(raw), field, "not a finite number");
  }
  if (raw.trim() === "") return null;
  let s = raw.replace(MINUS, "-").replace(CURRENCY, "").replace(SPACES, "");
  if (s === "") return unparseable(raw, field, "no digits");

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s === "") return unparseable(raw, field, "no digits");

  let digits: string | null;
  const decimalComma = /,\d{2}$/.test(s);
  if (decimalComma) {
    const intPart = s.slice(0, -3);
    const int = intPart === "" ? "0" : dropThousands(intPart, ".");
    digits = int === null ? null : `${int}.${s.slice(-2)}`;
  } else {
    const dot = s.lastIndexOf(".");
    const intPart = dot >= 0 ? s.slice(0, dot) : s;
    const frac = dot >= 0 ? s.slice(dot + 1) : "";
    if (dot >= 0 && !/^\d+$/.test(frac)) digits = null;
    else {
      const int = intPart === "" ? "0" : dropThousands(intPart, ",");
      digits = int === null ? null : frac ? `${int}.${frac}` : int;
    }
  }
  if (digits === null) return unparseable(raw, field, "separators do not form a number");

  const value = new Decimal(digits);
  return { ok: true, value: negative ? value.negated() : value };
}
