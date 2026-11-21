import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { loadFxRates, loadInvoices } from "../../../dataset";
import { FxTable, toCad } from "../fx";

const table = new FxTable(loadFxRates());

describe("FX lookup", () => {
  it("uses the row for the invoice date", () => {
    expect(table.lookup("USD", "2026-10-31")).toEqual({
      rate: new Decimal("1.3417"),
      rateDate: "2026-10-31",
      fallback: false,
    });
  });

  it("uses the last row past the end and marks the fallback", () => {
    expect(table.lastDate).toBe("2026-11-02");
    expect(table.lookup("USD", "2026-11-15")).toEqual({
      rate: new Decimal("1.3414"),
      rateDate: "2026-11-02",
      fallback: true,
    });
  });

  it("uses the latest earlier row for a gap, marked as fallback", () => {
    const gappy = new FxTable([
      { date: "2026-03-02", usdToCad: new Decimal("1.40") },
      { date: "2026-03-06", usdToCad: new Decimal("1.36") },
      { date: "2026-03-04", usdToCad: new Decimal("1.38") },
    ]);
    expect(gappy.lookup("USD", "2026-03-05")).toMatchObject({ rateDate: "2026-03-04", fallback: true });
    expect(gappy.lookup("USD", "2026-03-04")).toMatchObject({ rateDate: "2026-03-04", fallback: false });
  });

  it("has no rate before the first row or without a date", () => {
    expect(table.lookup("USD", "2025-12-31")).toBeNull();
    expect(table.lookup("USD", null)).toBeNull();
  });

  it("is 1 for CAD", () => {
    expect(table.lookup("CAD", null)).toEqual({ rate: new Decimal(1), rateDate: null, fallback: false });
  });

  it("reproduces every history invoice's rate and CAD total", () => {
    const misses = loadInvoices().filter((inv) => {
      const fx = table.lookup(inv.currency as "CAD" | "USD", inv.invoiceDate)!;
      return !fx.rate.eq(inv.fxRateToCad) || !toCad(inv.total, fx.rate).eq(inv.totalCad) || fx.fallback;
    });
    expect(misses.map((i) => i.invoiceId)).toEqual([]);
  });
});
