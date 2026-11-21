import { describe, expect, it } from "vitest";
import { parseAmount } from "../amount";

describe("parseAmount", () => {
  it.each([
    ["1 014,18 $", "1014.18"],
    ["1 014,18 $", "1014.18"],
    ["1 014,18 $", "1014.18"],
    ["$1,014.18", "1014.18"],
    ["1,014.18", "1014.18"],
    ["1014.18", "1014.18"],
    ["1,014", "1014"],
    ["1,234,567.89", "1234567.89"],
    ["1.234.567,89", "1234567.89"],
    ["14 543,10 $", "14543.1"],
    ["12,50", "12.5"],
    ["0,99", "0.99"],
    [",99", "0.99"],
    [".5", "0.5"],
    ["$ 250", "250"],
    ["CAD 1,250.00", "1250"],
    ["1,250.00 CAD", "1250"],
    ["US$ 980.00", "980"],
    ["-245.00", "-245"],
    ["-$245.00", "-245"],
    ["$-245.00", "-245"],
    ["245.00-", "-245"],
    ["($245.00)", "-245"],
    ["(1 014,18 $)", "-1014.18"],
    ["− 82,50 $", "-82.5"],
    ["+12.00", "12"],
    ["0.00", "0"],
    ["1.2345", "1.2345"],
  ])("%j → %s", (raw, expected) => {
    const r = parseAmount(raw);
    expect(r).toMatchObject({ ok: true });
    if (r?.ok) expect(r.value.toString()).toBe(expected);
  });

  it.each(["12,5", "1,23,456", "1.2.3", "abc", "1 014,18,00", "$", "--5", "12,3456", "1,0145"])(
    "%j is AMOUNT_UNPARSEABLE",
    (raw) => {
      const r = parseAmount(raw, "total");
      expect(r).toMatchObject({ ok: false, issue: { code: "AMOUNT_UNPARSEABLE", field: "total", raw } });
    },
  );

  it("returns null for a missing or blank amount", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("  ")).toBeNull();
  });

  it("accepts a number without float noise", () => {
    const r = parseAmount(0.1);
    expect(r?.ok && r.value.plus("0.2").toString()).toBe("0.3");
  });
});
