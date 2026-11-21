import { describe, expect, it } from "vitest";
import { invoiceNumberKeys } from "../invoice-number";

describe("invoice number keys", () => {
  it.each([
    // printed, numberKey, digitsKey
    ["000604", "604", "604"],
    ["604", "604", "604"],
    ["FA-001655", "FA001655", "1655"],
    ["1655-A", "1655A", "1655"],
    ["INV-01561", "INV01561", "1561"],
    ["inv 01561", "INV01561", "1561"],
    ["FA-000583", "FA000583", "583"],
    ["583", "583", "583"],
    ["AU26-2207", "AU262207", "262207"],
    ["Facture n° 557", "FACTUREN557", "557"],
    ["0000", "0", "0"],
    ["CR-", "CR", null],
    ["", null, null],
    ["  -/ ", null, null],
  ])("%s → %s / %s", (printed, numberKey, digitsKey) => {
    expect(invoiceNumberKeys(printed)).toEqual({ numberKey, digitsKey });
  });

  it("returns nulls for a missing number", () => {
    expect(invoiceNumberKeys(null)).toEqual({ numberKey: null, digitsKey: null });
  });

  it("makes the two history reformatting pairs meet on digitsKey but not numberKey", () => {
    expect(invoiceNumberKeys("000604").numberKey).toBe(invoiceNumberKeys("604").numberKey);
    expect(invoiceNumberKeys("FA-001655").numberKey).not.toBe(invoiceNumberKeys("1655-A").numberKey);
    expect(invoiceNumberKeys("FA-001655").digitsKey).toBe(invoiceNumberKeys("1655-A").digitsKey);
  });
});
