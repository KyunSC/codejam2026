import { beforeAll, describe, expect, it } from "vitest";
import { type Dataset, loadDataset, loadInvoices, parseEmails, parseIntCell } from "../dataset";

describe("integer cells", () => {
  it("parses whole numbers, trimming spaces", () => {
    expect(parseIntCell("30", "payment_terms_days")).toBe(30);
    expect(parseIntCell(" 0 ", "payment_terms_days")).toBe(0);
    expect(parseIntCell("-2", "x")).toBe(-2);
  });
  it("rejects a blank cell instead of reading it as 0", () => {
    expect(() => parseIntCell("", "payment_terms_days")).toThrow(/Blank integer/);
    expect(() => parseIntCell("   ", "payment_terms_days")).toThrow(/Blank integer/);
  });
  it("rejects exponent, hex and decimal forms", () => {
    for (const v of ["1e1", "0x1F", "3.0", "12abc"]) {
      expect(() => parseIntCell(v, "x"), v).toThrow(/Not an integer/);
    }
  });
});

describe("emails.json parsing", () => {
  const good = {
    email_id: "EM-001",
    from_name: "A",
    from_address: "a@x.example",
    to_address: "ap@harborline.example",
    subject: "Invoice",
    received_at: "2026-10-20T09:15:00",
    body: "Attached.",
    attachments: ["a.pdf"],
  };
  it("reads a complete email", () => {
    expect(parseEmails(JSON.stringify([good]))[0]).toMatchObject({ emailId: "EM-001", attachments: ["a.pdf"] });
  });
  it("throws on a missing field instead of storing the text 'undefined'", () => {
    const noSubject: Partial<typeof good> = { ...good };
    delete noSubject.subject;
    expect(() => parseEmails(JSON.stringify([noSubject]))).toThrow(/EM-001.*"subject" must be a string/);
  });
  it("throws on a bad timestamp or attachment list", () => {
    expect(() => parseEmails(JSON.stringify([{ ...good, received_at: "2026-02-30T09:00:00" }]))).toThrow(/received_at/);
    expect(() => parseEmails(JSON.stringify([{ ...good, attachments: "a.pdf" }]))).toThrow(/attachments/);
  });
});

describe("dataset loaders", () => {
  // Loaded in beforeAll so a loader error fails these tests by name instead of the whole file.
  let ds: Dataset;
  beforeAll(() => {
    ds = loadDataset();
  });

  it("row counts equal BUILD_PLAN's Tables section", () => {
    const counts = Object.fromEntries(Object.entries(ds).map(([k, rows]) => [k, rows.length]));
    expect(counts).toEqual({
      users: 40,
      departments: 8,
      approvalPolicies: 13,
      glAccounts: 30,
      taxCodes: 6,
      vendors: 56,
      bankChanges: 9,
      contracts: 27,
      purchaseOrders: 52,
      invoices: 426,
      invoiceLines: 809,
      approvals: 474,
      payments: 415,
      bankStatement: 354,
      cardTransactions: 590,
      fxRates: 306,
      emails: 44,
    });
  });

  it("matches the breakdowns BUILD_PLAN gives", () => {
    const count = <T>(rows: readonly T[], pred: (r: T) => boolean) => rows.filter(pred).length;
    expect(count(ds.invoiceLines, (l) => l.lineType === "services")).toBe(711);
    expect(count(ds.invoiceLines, (l) => l.lineType === "goods")).toBe(98);
    expect(count(ds.vendors, (v) => v.status === "pending_review")).toBe(3);
    expect(count(ds.vendors, (v) => v.status === "on_hold")).toBe(1);
    expect(count(ds.invoices, (i) => i.currency === "USD")).toBe(34);
    expect(count(ds.payments, (p) => p.method === "CHEQUE")).toBe(22);
    expect(count(ds.bankStatement, (b) => b.debit !== null && b.credit === null)).toBe(354);
    expect(count(ds.bankChanges, (b) => !b.verifiedByCallback)).toBe(1);
    expect(count(ds.emails, (e) => e.attachments.length === 0)).toBe(4);
  });

  it("keeps leading zeros in ids and bank numbers", () => {
    expect(ds.vendors.find((v) => v.vendorId === "V001")?.bankInstitution).toBe("004");
    expect(ds.invoices.some((i) => /^0/.test(i.vendorInvoiceNumber))).toBe(true);
  });

  it("parses money as Decimal, flags as booleans, blanks as null", () => {
    const first = ds.invoices.find((i) => i.invoiceId === "AP-00001");
    expect(first?.total.toFixed(2)).toBe("2520.00");
    expect(first?.poId).toBeNull();
    expect(typeof ds.vendors[0].requiresPo).toBe("boolean");
    expect(ds.users.some((u) => u.managerId === null)).toBe(true);
  });

  it("keeps the planted blank tax code on AP-00325 as null", () => {
    const line = ds.invoiceLines.find((l) => l.invoiceId === "AP-00325" && l.lineNo === 1);
    expect(line?.gstHstCode).toBeNull();
    expect(line?.pstQstCode).toBeNull();
  });

  it("reads each file once and returns frozen rows", () => {
    expect(loadInvoices()).toBe(ds.invoices);
    expect(Object.isFrozen(ds.invoices)).toBe(true);
    expect(Object.isFrozen(ds.invoices[0])).toBe(true);
  });
});
