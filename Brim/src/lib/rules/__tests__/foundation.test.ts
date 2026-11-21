import { describe, expect, it } from "vitest";
import { loadDataset } from "../../dataset";
import { today } from "../../today";
import { money, pct } from "../format";
import { loadHistory } from "../history";
import { digitsKey, idKey, merchantDescriptor, nameSimilarity, normalizeName, numberKey } from "../keys";
import { buildRefs, refsAsOf } from "../refs";

describe("number keys", () => {
  it.each([
    ["000604", "604", "604"],
    ["604", "604", "604"],
    ["FA-001655", "FA001655", "1655"],
    ["1655-A", "1655A", "1655"],
    ["inv-01529", "INV01529", "1529"],
    ["  ", null, null],
    [null, null, null],
  ])("%s → numberKey %s, digitsKey %s", (printed, nk, dk) => {
    expect(numberKey(printed)).toBe(nk);
    expect(digitsKey(printed)).toBe(dk);
  });
});

describe("name normalisation", () => {
  it.each([
    ["Harlow & Stern LLP", "harlow and stern"],
    ["Harlow and Stern LLP", "harlow and stern"],
    ["Polar Freight Lines Ltd.", "polar freight lines"],
    ["Great Lakes Carriers Inc.", "great lakes carriers"],
    ["Beaumont Rivières Avocats S.E.N.C.R.L.", "beaumont rivieres avocats s e n c r l"],
    ["Acme Co", "acme"],
    ["Co", "co"],
    [null, ""],
  ])("%s → %s", (raw, want) => {
    expect(normalizeName(raw)).toBe(want);
  });

  it("scores word overlap", () => {
    expect(nameSimilarity("Harlow & Stern LLP", "Harlow and Stern")).toBe(1);
    expect(nameSimilarity("Polar Freight Lines", "Polar Freight")).toBeCloseTo(2 / 3);
    expect(nameSimilarity("Polar Freight", "")).toBe(0);
  });

  it("compares ids on letters and digits", () => {
    expect(idKey("995133220 RT 0001")).toBe("995133220RT0001");
    expect(idKey("")).toBeNull();
  });

  it("builds card descriptors like the card network", () => {
    expect(merchantDescriptor("Paper Trail Office Supply Inc.", 22)).toBe("PAPER TRAIL OFFICE SUP");
  });
});

describe("format", () => {
  it("formats money and rates", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(-672)).toBe("-$672.00");
    expect(money(10, "USD")).toBe("$10.00 USD");
    expect(pct(0.09975)).toBe("9.975%");
    expect(pct(0.13)).toBe("13%");
  });
});

describe("history adapter", () => {
  const ds = loadDataset();
  const { known, resolved } = loadHistory(ds);

  it("adapts every history invoice", () => {
    expect(known).toHaveLength(426);
    expect(resolved.size).toBe(426);
  });

  it("keeps lines, keys and amounts", () => {
    const inv = resolved.get("AP-00073")!;
    const row = ds.invoices.find((i) => i.invoiceId === "AP-00073")!;
    expect(inv.numberKey).toBe(numberKey(row.vendorInvoiceNumber));
    expect(inv.total!.equals(row.total)).toBe(true);
    expect(inv.lines.length).toBe(ds.invoiceLines.filter((l) => l.invoiceId === "AP-00073").length);
    expect(inv.lines.every((l) => l.lineTypeSource === "account" && l.glAccount)).toBe(true);
  });

  it("rebuilds tax lines whose amounts add up to the invoice's tax", () => {
    for (const row of ds.invoices) {
      const inv = resolved.get(row.invoiceId)!;
      const taxSum = inv.taxes.reduce((s, t) => s + t.amount.toNumber(), 0);
      expect(taxSum, row.invoiceId).toBeCloseTo(row.gstHstAmount.plus(row.pstQstAmount).toNumber(), 2);
    }
  });

  it("represents a no-tax invoice with no tax lines", () => {
    const zeroTax = ds.invoices.find((i) => i.gstHstAmount.isZero() && i.pstQstAmount.isZero())!;
    expect(resolved.get(zeroTax.invoiceId)!.taxes).toEqual([]);
  });

  it("derives terms from the dates", () => {
    const row = ds.invoices[0];
    const inv = resolved.get(row.invoiceId)!;
    expect(inv.terms?.netDays).toBeGreaterThanOrEqual(0);
    expect(inv.billToAddress).toMatch(new RegExp(` ${row.shipToProvince} `));
  });
});

describe("refs", () => {
  const ds = loadDataset();
  const { known } = loadHistory(ds);
  const refs = buildRefs(ds, known, today());

  it("indexes reference tables", () => {
    expect(refs.today).toBe("2026-11-02");
    expect(refs.vendors.size).toBe(56);
    expect(refs.contractByVendor.size).toBe(27);
    expect(refs.fxRates[0].date).toBe("2026-01-01");
    expect(refs.invoicesByVendor.get(known[0].vendorId!)?.length).toBeGreaterThan(0);
  });

  it("replays history with only earlier invoices known", () => {
    let n = 0;
    let prev = "";
    for (const [inv, asOf] of refsAsOf(refs, known)) {
      expect(asOf.invoices).toHaveLength(n);
      expect(asOf.self?.invoiceId).toBe(inv.invoiceId);
      expect(asOf.invoices.some((k) => k.invoiceId === inv.invoiceId)).toBe(false);
      expect(inv.receivedDate >= prev).toBe(true);
      prev = inv.receivedDate;
      n++;
    }
    expect(n).toBe(426);
  });
});
