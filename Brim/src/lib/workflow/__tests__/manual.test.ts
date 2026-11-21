import { describe, expect, it } from "vitest";
import { normalizeDetailed } from "../../pipeline/normalize";
import { typedExtraction, typedTaxLabel, type TypedInvoice } from "../manual";

const typed = (over: Partial<TypedInvoice> = {}): TypedInvoice => ({
  vendorName: "Paper Trail Office Supply",
  invoiceNumber: "INV-1001",
  invoiceDate: "2026-10-20",
  dueDate: "2026-11-19",
  currency: "CAD",
  poNumber: null,
  deliveredTo: "ON",
  subtotal: "1000.00",
  gstHstAmount: "130.00",
  pstQstAmount: null,
  total: "1130.00",
  lines: [{ description: "Copy paper", quantity: "10", unitPrice: "100", amount: "1000.00" }],
  ...over,
});

describe("typedTaxLabel", () => {
  it("names the tax from the rate it implies on the subtotal", () => {
    expect(typedTaxLabel("gstHst", "130.00", "1000.00")).toBe("HST (13%)");
    expect(typedTaxLabel("gstHst", "50.00", "1000.00")).toBe("GST (5%)");
    expect(typedTaxLabel("pstQst", "99.75", "1000.00")).toBe("QST (9.975%)");
    expect(typedTaxLabel("pstQst", "70.00", "1000.00")).toBe("PST (7%)");
  });
  it("tolerates a cent of rounding", () => {
    expect(typedTaxLabel("gstHst", "170.30", "1309.97")).toBe("HST (13%)");
  });
  it("stays ambiguous when the rate matches nothing or there is no subtotal", () => {
    expect(typedTaxLabel("gstHst", "90.00", "1000.00")).toBe("GST/HST");
    expect(typedTaxLabel("pstQst", "10.00", null)).toBe("PST/QST");
  });
});

describe("typedExtraction", () => {
  it("carries every typed field into the reader's shape", () => {
    const x = typedExtraction(typed());
    expect(x.docType).toBe("invoice");
    expect(x.vendor.name).toBe("Paper Trail Office Supply");
    expect(x.invoiceNumber).toBe("INV-1001");
    expect(x.taxes).toEqual([{ label: "HST (13%)", amount: "130.00" }]);
    expect(x.lines).toHaveLength(1);
    expect(x.unreadable).toEqual([]);
  });

  it("leaves out empty or zero tax boxes and keeps both taxes for Quebec", () => {
    expect(typedExtraction(typed({ gstHstAmount: "0.00" })).taxes).toEqual([]);
    const qc = typedExtraction(typed({ gstHstAmount: "50.00", pstQstAmount: "99.75", total: "1149.75" }));
    expect(qc.taxes.map((t) => t.label)).toEqual(["GST (5%)", "QST (9.975%)"]);
  });

  it("bills to the chosen office's full address, or nothing when not shown", () => {
    expect(typedExtraction(typed()).billTo.address).toContain("Toronto ON");
    expect(typedExtraction(typed({ deliveredTo: null })).billTo.address).toBeNull();
  });

  it("treats a negative total as a credit note", () => {
    expect(typedExtraction(typed({ total: "-113.00" })).docType).toBe("credit_note");
  });

  it("normalises into tax codes the checks understand, and keeps arithmetic errors for them to find", () => {
    const n = normalizeDetailed(typedExtraction(typed({ total: "1230.00" })), {
      fileSha256: "typed:test",
      textLayer: null,
      hasTextLayer: false,
      receivedDate: "2026-11-02",
    }).invoice;
    expect(n.taxes.map((t) => t.taxCode)).toEqual(["HST13"]);
    expect(n.total?.toFixed(2)).toBe("1230.00"); // 1000 + 130 ≠ 1230: ARITHMETIC_TOTAL's job
    expect(n.parseIssues).toEqual([]);
  });
});
