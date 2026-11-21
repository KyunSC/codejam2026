import { describe, expect, it } from "vitest";
import { currencyFromLabel } from "../currency";
import { normalizeTaxLabel } from "../tax-label";
import { normalizeTerms } from "../terms";

describe("normalizeTaxLabel", () => {
  it.each([
    ["HST", "HST13", null],
    ["HST 13%", "HST13", "0.13"],
    ["HST (13 %)", "HST13", "0.13"],
    ["TVH 13 %", "HST13", "0.13"],
    ["GST", "GST5", null],
    ["GST 5%", "GST5", "0.05"],
    ["TPS (5 %)", "GST5", "0.05"],
    ["TPS #123456789 RT0001 5%", "GST5", "0.05"],
    ["PST 7%", "PST7_BC", "0.07"],
    ["TVP", "PST7_BC", null],
    ["QST 9.975%", "QST9975", "0.09975"],
    ["TVQ (9,975 %)", "QST9975", "0.09975"],
    ["GST/HST 13%", "HST13", "0.13"],
    ["TPS/TVH 5 %", "GST5", "0.05"],
    ["Tax exempt", "EXEMPT", null],
    ["Exonéré", "EXEMPT", null],
    // The label is kept as printed even when the rate looks wrong; checks judge it.
    ["HST 5%", "HST13", "0.05"],
  ])("%j → %s at %s", (label, code, rate) => {
    const r = normalizeTaxLabel(label);
    expect(r.taxCode).toBe(code);
    expect(r.ratePrinted?.toString() ?? null).toBe(rate);
    expect(r.issue).toBeNull();
  });

  it.each(["Sales tax", "Tax", "GST/HST", "GST/HST 7%", "GST + PST 12%", "VAT 20%"])(
    "%j is TAX_LABEL_UNKNOWN",
    (label) => {
      expect(normalizeTaxLabel(label, "taxes.0.label")).toMatchObject({
        taxCode: null,
        issue: { code: "TAX_LABEL_UNKNOWN", field: "taxes.0.label", raw: label },
      });
    },
  );
});

describe("normalizeTerms", () => {
  it.each([
    ["Net 30", 30, null, null],
    ["NET 45", 45, null, null],
    ["Net 30 days", 30, null, null],
    ["N30", 30, null, null],
    ["n/30", 30, null, null],
    ["Payment due within 15 days", 15, null, null],
    ["Due on receipt", 0, null, null],
    ["Payable upon receipt", 0, null, null],
    ["Payable dès réception", 0, null, null],
    ["Payable à réception", 0, null, null],
    ["2/10 Net 30", 30, "2", 10],
    ["2/10, n/30", 30, "2", 10],
    ["2% 10 Net 30", 30, null, null],
    ["1.5/15 Net 45", 45, "1.5", 15],
    ["Net 30 jours", 30, null, null],
    ["30 jours net", 30, null, null],
    ["Net à 30 jours", 30, null, null],
    ["See contract", null, null, null],
  ])("%j → net %s, %s%% in %s", (raw, netDays, pct, days) => {
    const t = normalizeTerms(raw)!;
    expect(t.raw).toBe(raw);
    expect(t.netDays).toBe(netDays);
    expect(t.discountPct?.toString() ?? null).toBe(pct);
    expect(t.discountDays).toBe(days);
  });

  it("returns null for no terms", () => {
    expect(normalizeTerms(null)).toBeNull();
    expect(normalizeTerms("  ")).toBeNull();
  });
});

describe("currencyFromLabel", () => {
  it.each([
    [["Total CAD"], "CAD"],
    [["Total USD"], "USD"],
    [["TOTAL (US$)"], "USD"],
    [["Total $US"], "USD"],
    [["Total CA$"], "CAD"],
    [["Total C$"], "CAD"],
    [["Total 1 014,18 $ CA"], "CAD"],
    [["Montant dû en dollars canadiens"], "CAD"],
    [["All amounts in U.S. dollars"], "USD"],
    [[null, "USD"], "USD"],
    [["Total"], null],
    [["Total $"], null],
    [["Total CAD", "USD"], null],
    [[], null],
  ])("%j → %s", (texts, expected) => {
    expect(currencyFromLabel(...texts)).toBe(expected);
  });
});
