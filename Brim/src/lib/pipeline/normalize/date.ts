/**
 * Dates as printed → `YYYY-MM-DD` (BUILD_PLAN "Normalisation", Dates).
 *
 * Order: ISO (`2026-10-28`, also with `/` or `.`), then numeric day/month forms, then month
 * names in English and French (`October 28, 2026`, `28 Oct 2026`, `28-Oct-2026`,
 * `le 1er novembre 2026`, `28 oct. 2026`).
 *
 * A numeric date like `03/04/2026` reads as 3 April (DD/MM) or 4 March (MM/DD). When both
 * readings are real dates and differ, no date is picked: the result is DATE_AMBIGUOUS with both
 * candidates, and the clerk chooses. `13/04/2026` or `04/13/2026` have one reading and are fine.
 *
 * Two-digit years and anything else unrecognised raise DATE_UNPARSEABLE; nothing is guessed.
 */
import type { IsoDate, ParseIssue } from "../../types";
import { isRealIsoDate } from "../../today";

export type DateResult = { ok: true; value: IsoDate } | { ok: false; issue: ParseIssue; candidates: IsoDate[] };

const MONTHS: Record<string, number> = {
  // English
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
  // French (accents removed before lookup)
  janvier: 1,
  janv: 1,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

function iso(y: number, m: number, d: number): IsoDate | null {
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isRealIsoDate(s) ? s : null;
}

function fail(
  raw: string,
  field: string,
  code: ParseIssue["code"],
  detail: string,
  candidates: IsoDate[] = [],
): DateResult {
  return { ok: false, issue: { field, code, raw, detail }, candidates };
}

export function parseDate(raw: string | null | undefined, field = "date"): DateResult | null {
  if (raw == null || raw.trim() === "") return null;
  const s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  // ISO first: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const v = iso(+m[1], +m[2], +m[3]);
    return v ? { ok: true, value: v } : fail(raw, field, "DATE_UNPARSEABLE", "not a real calendar date");
  }

  // Numeric DD/MM/YYYY or MM/DD/YYYY
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    if (m[3].length !== 4) return fail(raw, field, "DATE_UNPARSEABLE", "two-digit year");
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    const dayFirst = iso(y, b, a);
    const monthFirst = iso(y, a, b);
    const readings = [...new Set([dayFirst, monthFirst].filter((v): v is IsoDate => v !== null))];
    if (readings.length === 1) return { ok: true, value: readings[0] };
    if (readings.length === 0) return fail(raw, field, "DATE_UNPARSEABLE", "not a real calendar date");
    return fail(raw, field, "DATE_AMBIGUOUS", `reads as ${dayFirst} (day first) or ${monthFirst} (month first)`, [
      dayFirst!,
      monthFirst!,
    ]);
  }

  // Month names. Drop weekday names, "le", ordinal suffixes, commas and trailing dots.
  const words = s
    .replace(/[,]/g, " ")
    .replace(/(\d)(st|nd|rd|th|er|re|e)\b/g, "$1")
    .split(/[\s-/]+/)
    .map((w) => w.replace(/\.$/, ""))
    .filter((w) => w !== "" && w !== "le" && w !== "the" && w !== "of" && w !== "de");
  const nums = words.filter((w) => /^\d+$/.test(w));
  const names = words.filter((w) => !/^\d+$/.test(w));
  const months = names.map((w) => MONTHS[w]).filter((n): n is number => n !== undefined);
  if (months.length === 1 && nums.length === 2) {
    const year = nums.find((n) => n.length === 4);
    const day = nums.find((n) => n.length <= 2);
    if (!year || !day) return fail(raw, field, "DATE_UNPARSEABLE", "needs a four-digit year and a day");
    const v = iso(+year, months[0], +day);
    return v ? { ok: true, value: v } : fail(raw, field, "DATE_UNPARSEABLE", "not a real calendar date");
  }

  return fail(raw, field, "DATE_UNPARSEABLE", "format not recognised");
}
