/** Formatting for flag sentences and evidence. Every flag reads as a sentence with the numbers in it. */
import type Decimal from "decimal.js";
import type { EvidenceItem, Flag, FlagClass, FlagCode, FlagEffect } from "../types";

/** `$1,234.56`, or `-$672.00`; with a currency suffix when not CAD. */
export function money(value: Decimal | number | null | undefined, currency: string | null = "CAD"): string {
  if (value === null || value === undefined) return "(none)";
  const n = typeof value === "number" ? value : value.toNumber();
  const abs = Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${abs}${currency && currency !== "CAD" ? ` ${currency}` : ""}`;
}

/** `13%`, `9.975%` from a rate such as 0.13. */
export function pct(rate: Decimal | number): string {
  const n = typeof rate === "number" ? rate : rate.toNumber();
  return `${Number((n * 100).toFixed(3))}%`;
}

export function ev(label: string, value: string | number | Decimal | null | undefined, source: string): EvidenceItem {
  return { label, value: value === null || value === undefined ? "(none)" : String(value), source };
}

export function makeFlag(
  code: FlagCode,
  klass: FlagClass,
  effect: FlagEffect,
  message: string,
  evidence: EvidenceItem[],
  related?: Flag["related"],
): Flag {
  return related ? { code, klass, effect, message, evidence, related } : { code, klass, effect, message, evidence };
}
