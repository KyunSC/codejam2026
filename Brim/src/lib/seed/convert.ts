/**
 * Small converters from dataset values to what Prisma stores.
 * `@db.Date` columns take a Date at UTC midnight; Decimal columns take a string so no
 * precision is lost between decimal.js and Prisma's own Decimal.
 */
import type Decimal from "decimal.js";
import type { IsoDate } from "../types";

export function dateOnly(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function optDateOnly(iso: IsoDate | null): Date | null {
  return iso === null ? null : dateOnly(iso);
}

/** Dataset timestamps carry no zone ("2026-01-03T15:59:00"); Harborline is in Toronto, but the
 * history is stored as written, read as UTC, so the same text always gives the same instant. */
export function timestamp(iso: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

export function money(d: Decimal): string {
  return d.toString();
}

export function optMoney(d: Decimal | null): string | null {
  return d === null ? null : d.toString();
}
