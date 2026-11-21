import { describe, expect, it } from "vitest";
import type { Extracted } from "../../types";
import { checkArithmetic, computeEvidence, TextIndex } from "../evidence";

function extracted(over: Partial<Extracted> = {}): Extracted {
  return {
    docType: "invoice",
    language: "en",
    vendor: {
      name: "Acme Test Supplies Inc.",
      address: "1 Main St, Toronto ON",
      gstHstNumber: "123456789 RT0001",
      qstNumber: null,
    },
    billTo: { name: "Harborline", address: "200 Bay St, Toronto ON" },
    invoiceNumber: "INV-1001",
    invoiceDate: "October 28, 2026",
    dueDate: null,
    terms: "Net 30",
    poNumber: null,
    creditNoteRef: null,
    currency: "CAD",
    lines: [
      { description: "Consulting hours", quantity: "10", unitPrice: "150.00", amount: "1,500.00" },
      { description: "Travel", quantity: "1", unitPrice: "214.18", amount: "214.18" },
    ],
    subtotal: "1,714.18",
    taxes: [{ label: "HST 13%", amount: "222.84" }],
    total: "1,937.02",
    remit: { institution: null, transit: null, account: null, text: null },
    notes: [],
    unreadable: [],
    ...over,
  };
}

const TEXT = `Acme Test Supplies Inc.
1 Main St
Toronto ON
GST/HST # 123456789 RT0001
Bill to: Harborline, 200 Bay St, Toronto ON
Invoice # INV-1001   Date: October 28, 2026   Terms: Net 30
Consulting hours  10  150.00  1 500,00
Travel  1  214.18  214.18
Subtotal 1 714,18   HST 13% 222.84   Total CAD 1 937,02`;

describe("text-layer matching", () => {
  it.each([
    ["1,500.00", true],
    ["1 500,00 $", true],
    ["INV-1001", true],
    ["inv 1001", true],
    ["Acme Test Supplies Inc", true],
    ["1 Main St, Toronto ON", true],
    ["October 28, 2026", true],
    ["1", true], // "1 Main St" stands alone
    ["2026-10-28", false],
    ["INV-1002", false],
    ["50.00", false], // inside "150.00": runs into a digit
    ["0", false],
    ["1500", true], // by value
    ["10", true],
    ["15000", false], // "150.00 1 500,00" must not merge into one number, nor "150.00" lose its point
    ["HST 13%", true], // a label ending in a digit, followed by an amount
  ])("%j in text → %s", (value, found) => {
    expect(new TextIndex(TEXT).has(value, /^[\d$ ,.]+$/.test(value))).toBe(found);
  });
});

describe("arithmetic", () => {
  it("closes on a correct invoice", () => {
    expect(checkArithmetic(extracted())).toEqual({ lines: [true, true], subtotal: true, total: true, closes: true });
  });

  it.each([
    ["a line", { lines: [{ description: "x", quantity: "10", unitPrice: "150.00", amount: "1,600.00" }] }, "lines"],
    ["the subtotal", { subtotal: "1,800.00" }, "subtotal"],
    ["the total", { total: "1,999.99" }, "total"],
  ] as const)("does not close when %s is wrong", (_, over, part) => {
    const a = checkArithmetic(extracted(over as Partial<Extracted>));
    expect(a.closes).toBe(false);
    if (part === "lines") expect(a.lines[0]).toBe(false);
    else expect(a[part]).toBe(false);
  });

  it("allows a cent of rounding and handles a credit note's negatives", () => {
    expect(checkArithmetic(extracted({ total: "1,937.03" })).total).toBe(true);
    const credit = extracted({
      lines: [{ description: "Credit", quantity: "1", unitPrice: "-200.00", amount: "-200.00" }],
      subtotal: "-200.00",
      taxes: [{ label: "HST", amount: "-26.00" }],
      total: "(226.00)",
    });
    expect(checkArithmetic(credit).closes).toBe(true);
  });

  it("cannot check lines without quantities, but still closes on totals", () => {
    const a = checkArithmetic(
      extracted({
        lines: [{ description: "Monthly retainer", quantity: null, unitPrice: null, amount: "1,714.18" }],
      }),
    );
    expect(a).toEqual({ lines: [null], subtotal: true, total: true, closes: true });
  });
});

describe("computeEvidence", () => {
  it("confirms everything on a clean PDF", () => {
    const r = computeEvidence(extracted(), { textLayer: TEXT, hasTextLayer: true });
    expect(r.needsReview).toBe(false);
    expect(r.evidence).toMatchObject({
      invoiceNumber: "confirmed",
      total: "confirmed",
      "lines.0.amount": "confirmed",
      dueDate: "missing",
    });
  });

  it("marks a value the text layer does not have, and sends a required one to review", () => {
    const r = computeEvidence(extracted({ invoiceNumber: "INV-1007" }), { textLayer: TEXT, hasTextLayer: true });
    expect(r.evidence.invoiceNumber).toBe("not_in_text");
    expect(r.reviewFields).toEqual([{ field: "invoiceNumber", evidence: "not_in_text" }]);
  });

  it("lets arithmetic confirm a reformatted number but not a wrong one", () => {
    const reformatted = computeEvidence(extracted({ total: "1937.02" }), { textLayer: TEXT, hasTextLayer: true });
    expect(reformatted.evidence.total).toBe("confirmed");
    const wrong = computeEvidence(extracted({ total: "1,973.02" }), { textLayer: TEXT, hasTextLayer: true });
    expect(wrong.evidence.total).toBe("not_in_text");
    expect(wrong.needsReview).toBe(true);
  });

  it("does not send a non-required field that is only not in the text to review", () => {
    const r = computeEvidence(extracted({ terms: "Net 45" }), { textLayer: TEXT, hasTextLayer: true });
    expect(r.evidence.terms).toBe("not_in_text");
    expect(r.needsReview).toBe(false);
  });

  it("marks unreadable fields from the model's list, including whole sections", () => {
    const r = computeEvidence(extracted({ invoiceDate: null, unreadable: ["invoiceDate", "remit"] }), {
      textLayer: TEXT,
      hasTextLayer: true,
    });
    expect(r.evidence.invoiceDate).toBe("unreadable");
    expect(r.evidence["remit.account"]).toBe("unreadable");
    expect(r.needsReview).toBe(true);
  });

  it("sends a missing invoice number to review", () => {
    expect(
      computeEvidence(extracted({ invoiceNumber: null }), { textLayer: TEXT, hasTextLayer: true }).reviewFields,
    ).toEqual([{ field: "invoiceNumber", evidence: "missing" }]);
  });

  describe("a scan (no text layer)", () => {
    it("confirms the numbers by arithmetic and leaves text fields unchecked", () => {
      const r = computeEvidence(extracted(), { textLayer: null, hasTextLayer: false });
      expect(r.evidence.total).toBe("confirmed");
      expect(r.evidence["lines.1.quantity"]).toBe("confirmed");
      expect(r.evidence.invoiceNumber).toBeUndefined();
      expect(r.needsReview).toBe(false);
    });

    it("compares a second read when arithmetic fails: differences are uncertain", () => {
      const first = extracted({ total: "1,987.02", invoiceNumber: "INV-1001" });
      const second = extracted({ total: "1,937.02", invoiceNumber: "INV-1001" });
      const r = computeEvidence(first, { textLayer: null, hasTextLayer: false, secondRead: second });
      expect(r.evidence.total).toBe("uncertain");
      expect(r.evidence.invoiceNumber).toBe("confirmed");
      expect(r.reviewFields).toContainEqual({ field: "total", evidence: "uncertain" });
    });

    it.each(["-12.34", "123.4"])("checks the sign and decimal position of %s", (total) => {
      const r = computeEvidence(extracted({ total: "12.34" }), {
        textLayer: null, hasTextLayer: false, secondRead: extracted({ total }),
      });
      expect(r.reviewFields).toContainEqual({ field: "total", evidence: "uncertain" });
    });

    it("requires review when an inconsistent scan has no second reading", () => {
      const r = computeEvidence(extracted({ total: "12.34" }), { textLayer: null, hasTextLayer: false });
      expect(r.reviewFields).toContainEqual({ field: "total", evidence: "uncertain" });
    });

    it("treats agreement on a wrong sum as a real error, not a reading problem", () => {
      const both = extracted({ total: "1,987.02" });
      const r = computeEvidence(both, { textLayer: null, hasTextLayer: false, secondRead: both });
      expect(r.arithmetic.total).toBe(false);
      expect(r.evidence.total).toBe("confirmed");
      expect(r.needsReview).toBe(false);
    });

    it("ignores a second read when the arithmetic already closes", () => {
      const r = computeEvidence(extracted(), {
        textLayer: null,
        hasTextLayer: false,
        secondRead: extracted({ invoiceNumber: "X" }),
      });
      expect(r.evidence.invoiceNumber).toBeUndefined();
    });
  });
});
