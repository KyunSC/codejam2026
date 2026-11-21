import { describe, expect, it } from "vitest";
import { computeTotals, lineAmount, parseMoney, taxChoices } from "../totals";

const CODES = [
  { id: "HST13", description: "Ontario HST 13%", rate: "0.13" },
  { id: "GST5", description: "GST 5%", rate: "0.05" },
  { id: "PST7_BC", description: "BC PST 7%", rate: "0.07" },
  { id: "QST9975", description: "Quebec QST 9.975%", rate: "0.09975" },
  { id: "EXEMPT", description: "Exempt", rate: "0" },
  { id: "FOREIGN", description: "Foreign", rate: "0" },
];
const choice = (id: string) => taxChoices(CODES).find((c) => c.id === id)!;

describe("parseMoney", () => {
  it("reads typed amounts and ignores $, commas and spaces", () => {
    expect(parseMoney("$1,234.50")?.toFixed(2)).toBe("1234.50");
    expect(parseMoney(" 12 ")?.toFixed(2)).toBe("12.00");
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("lineAmount", () => {
  it("multiplies quantity by unit price to the cent, half up", () => {
    expect(lineAmount("3", "19.99")).toBe("59.97");
    expect(lineAmount("1.5", "0.333")).toBe("0.50");
    expect(lineAmount("0.1", "0.3")).toBe("0.03");
  });
  it("is null when either is missing", () => {
    expect(lineAmount("", "5")).toBeNull();
    expect(lineAmount("2", "")).toBeNull();
  });
});

describe("computeTotals", () => {
  it("adds the lines without float drift", () => {
    expect(computeTotals(["0.10", "0.20"], null)).toEqual({ subtotal: "0.30", gstHst: "0.00", pstQst: "0.00", total: "0.30" });
  });
  it("Ontario HST 13%", () => {
    expect(computeTotals(["1000", "250.50"], choice("HST13"))).toEqual({
      subtotal: "1250.50",
      gstHst: "162.57",
      pstQst: "0.00",
      total: "1413.07",
    });
  });
  it("Quebec: GST and QST both on the pre-tax subtotal", () => {
    expect(computeTotals(["1000"], choice("GST5+QST9975"))).toEqual({
      subtotal: "1000.00",
      gstHst: "50.00",
      pstQst: "99.75",
      total: "1149.75",
    });
  });
  it("BC: GST 5% and PST 7%", () => {
    expect(computeTotals(["200"], choice("GST5+PST7_BC"))).toEqual({ subtotal: "200.00", gstHst: "10.00", pstQst: "14.00", total: "224.00" });
  });
  it("skips blank or unreadable line amounts", () => {
    expect(computeTotals(["100", "", "x"], choice("GST5")).total).toBe("105.00");
  });
});

describe("taxChoices", () => {
  it("builds the provincial combinations from the codes that exist", () => {
    expect(taxChoices(CODES).map((c) => c.id)).toEqual(["HST13", "GST5+QST9975", "GST5+PST7_BC", "GST5", "EXEMPT", "FOREIGN"]);
    expect(taxChoices([{ id: "GST5", description: "", rate: "0.05" }]).map((c) => c.id)).toEqual(["GST5"]);
  });
});
