/**
 * USD → CAD rate for an invoice date (BUILD_PLAN "Normalisation", FX).
 *
 * - CAD is 1, with no lookup.
 * - USD uses the fx_rates row for the invoice date.
 * - A date past the last row uses the last row and is marked `fallback` (FX_RATE_FALLBACK).
 * - A date with no row of its own but earlier rows (a gap) uses the latest earlier row, also
 *   marked `fallback`. The dataset has a row for every day, so this only guards uploads of
 *   future rate tables.
 * - A date before the first row, or no invoice date, has no rate: null, and the amount stays
 *   unconverted for the clerk. A later rate is never used for an earlier date.
 * Pure: the caller passes the rows (from the dataset or the FxRate table).
 */
import Decimal from "decimal.js";
import type { Currency, IsoDate } from "../../types";

export interface FxRow {
  date: IsoDate;
  usdToCad: Decimal;
}

export interface FxLookup {
  rate: Decimal;
  /** The date of the row used; equals the invoice date unless `fallback`. */
  rateDate: IsoDate | null;
  fallback: boolean;
}

export class FxTable {
  private readonly rows: FxRow[];
  private readonly byDate: Map<IsoDate, FxRow>;

  constructor(rows: ReadonlyArray<FxRow>) {
    this.rows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    this.byDate = new Map(this.rows.map((r) => [r.date, r]));
  }

  get lastDate(): IsoDate | null {
    return this.rows.at(-1)?.date ?? null;
  }

  lookup(currency: Currency, date: IsoDate | null): FxLookup | null {
    if (currency === "CAD") return { rate: new Decimal(1), rateDate: null, fallback: false };
    if (date === null) return null;
    const exact = this.byDate.get(date);
    if (exact) return { rate: exact.usdToCad, rateDate: exact.date, fallback: false };
    let lo = 0;
    let hi = this.rows.length - 1;
    let best: FxRow | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid].date < date) {
        best = this.rows[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best ? { rate: best.usdToCad, rateDate: best.date, fallback: true } : null;
  }
}

/** Amount in CAD, rounded to the cent (half up), as history's total_cad is. */
export function toCad(amount: Decimal, rate: Decimal): Decimal {
  return amount.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
