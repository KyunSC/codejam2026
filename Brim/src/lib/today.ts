import type { IsoDate } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The app's idea of today, as `YYYY-MM-DD`.
 *
 * Reads `APP_TODAY` so the demo matches the dataset's as-of date (2026-11-02).
 * Unset, it uses the current date in Toronto. Every rule that needs "today" calls this.
 */
export function today(env: Record<string, string | undefined> = process.env): IsoDate {
  const fixed = env.APP_TODAY?.trim();
  if (fixed) {
    if (!ISO_DATE.test(fixed) || Number.isNaN(Date.parse(`${fixed}T00:00:00Z`))) {
      throw new Error(`APP_TODAY must be a date written YYYY-MM-DD, got "${fixed}"`);
    }
    return fixed;
  }
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** `date` plus `days` (may be negative). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
