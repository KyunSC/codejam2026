import type { IsoDate } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a `YYYY-MM-DD` string that names a real calendar day.
 * `Date.parse` alone is not enough: V8 rolls "2026-02-30" over to March 2 instead of failing.
 */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Turns a string into an IsoDate, or null if it is not a real `YYYY-MM-DD` day.
 * Use this wherever a date enters the system (CSV, extraction, a form) so a bad value
 * never reaches date arithmetic, where it would become NaN and silently fail comparisons.
 */
export function toIsoDate(value: string | null | undefined): IsoDate | null {
  const v = value?.trim();
  return v && isRealIsoDate(v) ? v : null;
}

/**
 * The app's idea of today, as `YYYY-MM-DD`.
 *
 * Reads `APP_TODAY` so the demo matches the dataset's as-of date (2026-11-02).
 * Unset, it uses the current date in Toronto. Every rule that needs "today" calls this.
 *
 * Server only. In the browser `APP_TODAY` is not defined (Next inlines only NEXT_PUBLIC_*),
 * so it would silently fall back to the real date; pass the value down as a prop instead.
 * In a Server Component, call it after `await connection()` (or any request API) and inside
 * <Suspense>, or the page is prerendered and the date is frozen at build time.
 */
export function today(env: Record<string, string | undefined> = process.env): IsoDate {
  if (typeof window !== "undefined") {
    throw new Error("today() is server-only. Read it on the server and pass it to the client as a prop.");
  }
  const fixed = env.APP_TODAY?.trim();
  if (fixed) {
    if (!isRealIsoDate(fixed)) {
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
