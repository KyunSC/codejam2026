import { describe, expect, it } from "vitest";
import type { Extracted } from "../../../types";
import { normalize, normalizeDetailed } from "../index";

function extracted(over: Partial<Extracted> = {}): Extracted {
  return {
    docType: "invoice",
    language: "fr",
    vendor: {
      name: "Fournitures Test Ltée",
      address: "1 rue Principale, Montréal QC",
      gstHstNumber: "123456789 RT0001",
      qstNumber: "1234567890 TQ0001",
    },
    billTo: { name: "Harborline", address: "500 boul. René-Lévesque, Montréal QC" },
    invoiceNumber: "FA-001655",
    invoiceDate: "28 octobre 2026",
    dueDate: "27/11/2026",
    terms: "Net 30 jours",
    poNumber: " ",
    creditNoteRef: null,
    currency: "$ CA",
    lines: [{ description: "Services conseils", quantity: "2", unitPrice: "450,00", amount: "900,00" }],
    subtotal: "900,00 $",
    taxes: [
      { label: "TPS 5 %", amount: "45,00 $" },
      { label: "TVQ 9,975 %", amount: "89,78 $" },
    ],
    total: "1 034,78 $",
    remit: { institution: "815", transit: "12345", account: "9876543", text: null },
    notes: [],
    unreadable: [],
    ...over,
  };
}

const TEXT =
  "Fournitures Test Ltée 1 rue Principale, Montréal QC TPS 123456789 RT0001 TVQ 1234567890 TQ0001 FACTURE Facture n° FA-001655 Date 28 octobre 2026 Échéance 27/11/2026 Conditions Net 30 jours Services conseils 2 450,00 900,00 Sous-total 900,00 $ TPS 5 % 45,00 $ TVQ 9,975 % 89,78 $ Total 1 034,78 $ CA Institution 815 Transit 12345 Compte 9876543 Facturer à Harborline 500 boul. René-Lévesque, Montréal QC";

const ctx = {
  fileSha256: "ab".repeat(32),
  textLayer: TEXT,
  hasTextLayer: true,
  receivedDate: "2026-10-29",
  emailId: "EM-001",
};

describe("normalize", () => {
  it("turns a French invoice into typed values", () => {
    const n = normalize(extracted(), ctx);
    expect(n).toMatchObject({
      kind: "invoice",
      language: "fr",
      invoiceNumber: "FA-001655",
      numberKey: "FA001655",
      digitsKey: "1655",
      invoiceDate: "2026-10-28",
      dueDate: "2026-11-27",
      poNumber: null,
      currency: "CAD",
      receivedDate: "2026-10-29",
      emailId: "EM-001",
      parseIssues: [],
    });
    expect(n.terms).toMatchObject({ netDays: 30 });
    expect(n.total!.toString()).toBe("1034.78");
    expect(n.subtotal!.toString()).toBe("900");
    expect(n.lines[0]).toMatchObject({ lineNo: 1, description: "Services conseils" });
    expect(n.lines[0].unitPrice!.toString()).toBe("450");
    expect(n.taxes.map((t) => [t.taxCode, t.ratePrinted?.toString(), t.amount.toString()])).toEqual([
      ["GST5", "0.05", "45"],
      ["QST9975", "0.09975", "89.78"],
    ]);
    expect(Object.entries(n.evidence).filter(([, e]) => e === "not_in_text")).toEqual([]);
    expect(n.extracted.invoiceNumber).toBe("FA-001655");
  });

  it("collects parse issues instead of throwing, and sends them to review when required", () => {
    const r = normalizeDetailed(
      extracted({ invoiceDate: "03/04/2026", total: "1 034,7 $", taxes: [{ label: "Taxe", amount: "45,00" }] }),
      ctx,
    );
    expect(r.invoice.invoiceDate).toBeNull();
    expect(r.invoice.total).toBeNull();
    expect(r.invoice.taxes[0]).toMatchObject({ taxCode: null, labelPrinted: "Taxe" });
    expect(r.invoice.parseIssues.map((i) => [i.field, i.code])).toEqual([
      ["taxes.0.label", "TAX_LABEL_UNKNOWN"],
      ["total", "AMOUNT_UNPARSEABLE"],
      ["invoiceDate", "DATE_AMBIGUOUS"],
    ]);
    expect(r.needsReview).toBe(true);
  });

  it("makes a credit note printed in positives negative", () => {
    const n = normalize(
      extracted({
        docType: "credit_note",
        creditNoteRef: "FA-001600",
        lines: [{ description: "Crédit", quantity: "1", unitPrice: "600,00", amount: "600,00" }],
        subtotal: "600,00",
        taxes: [
          { label: "TPS 5 %", amount: "30,00" },
          { label: "TVQ", amount: "59,85" },
        ],
        total: "689,85",
      }),
      { ...ctx, textLayer: null, hasTextLayer: false },
    );
    expect(n.kind).toBe("credit_note");
    expect(n.creditNoteRef).toBe("FA-001600");
    expect(
      [n.total, n.subtotal, n.lines[0].amount, n.lines[0].unitPrice, n.taxes[1].amount].map((d) => d!.toString()),
    ).toEqual(["-689.85", "-600", "-600", "-600", "-59.85"]);
    expect(n.lines[0].quantity!.toString()).toBe("1");
    expect(n.evidence.total).toBe("confirmed"); // arithmetic on the printed values closes
  });

  it("leaves a credit note already printed negative alone", () => {
    const n = normalize(
      extracted({
        docType: "credit_note",
        lines: [{ description: "Credit", quantity: "1", unitPrice: "-672.00", amount: "-672.00" }],
        subtotal: "-672.00",
        taxes: [],
        total: "-672.00",
      }),
      ctx,
    );
    expect(n.total!.toString()).toBe("-672");
  });

  it("leaves currency null when the total label only says $", () => {
    expect(normalize(extracted({ currency: "$" }), ctx).currency).toBeNull();
    expect(normalize(extracted({ currency: "USD" }), ctx).currency).toBe("USD");
  });
});
