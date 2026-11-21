import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../../dataset";
import { today } from "../../today";
import type { NormalizedInvoice } from "../../types";
import { loadHistory } from "../history";
import { buildRefs, withInvoices } from "../refs";
import { resolveInvoice } from "../resolve";
import {
  effectiveRequester,
  findPo,
  poRemaining,
  resolveCreditTarget,
  resolveCurrency,
  resolveDepartment,
  resolveFx,
  resolveLineType,
  resolveProvince,
  resolveRequester,
  suggestPos,
} from "../resolve/fields";

const ds = loadDataset();
const { known } = loadHistory(ds);
const refs = buildRefs(ds, known, today());

describe("province from the bill-to address", () => {
  it.each([
    ["88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8", "ON"],
    ["1055 W Hastings St, Suite 900\nVancouver BC V6E 2E9", "BC"],
    ["Harborline Logistics, 250 6 Ave SW, Suite 700, Calgary AB T2P 3H7", "AB"],
    ["1250 Rene-Levesque O, Bureau 2200, Montreal QC H3B 4W8", "QC"],
    ["1250 boul. René-Lévesque Ouest, Montréal (QC)", "QC"],
    ["Somewhere in Calgary", "AB"],
    ["12 Main St, Halifax NS B3H 1A1", null],
    ["", null],
    [null, null],
  ])("%s → %s", (addr, want) => {
    expect(resolveProvince(addr)).toBe(want);
  });
});

describe("PO", () => {
  it("finds a printed PO regardless of punctuation and case", () => {
    expect(findPo("po 2026 0046", refs)?.poId).toBe("PO-2026-0046");
    expect(findPo("PO-2099-0001", refs)).toBeNull();
    expect(findPo(null, refs)).toBeNull();
  });

  it("computes the remaining balance from subtotals already invoiced", () => {
    expect(poRemaining(refs.purchaseOrders.get("PO-2026-0037")!, refs).toFixed(2)).toBe("1800.00");
    expect(poRemaining(refs.purchaseOrders.get("PO-2026-0046")!, refs).toFixed(2)).toBe("6803.89");
  });

  it.each([
    ["V012", "5000.00", ["PO-2026-0046"]],
    ["V044", "2150.00", []], // $1,800 left does not cover the subtotal
    ["V044", "1500.00", ["PO-2026-0037"]],
    ["V014", "100.00", []], // no open PO
    [null, "100.00", []],
  ])("suggests open POs that cover the subtotal: %s %s", (vendor, subtotal, want) => {
    expect(suggestPos(vendor, new Decimal(subtotal), refs)).toEqual(want);
  });
});

describe("department", () => {
  it("takes the PO's department first", () => {
    const po = refs.purchaseOrders.get("PO-2026-0046")!;
    expect(resolveDepartment(po, "V012", "ON", refs)).toMatchObject({ departmentId: po.departmentId, source: "po" });
  });

  it("returns none for a vendor with no history", () => {
    expect(resolveDepartment(null, "V052", "ON", refs)).toMatchObject({ departmentId: null, source: null });
    expect(resolveDepartment(null, null, null, refs).departmentId).toBeNull();
  });

  it("reproduces BUILD_PLAN's leave-one-out accuracy (368 of 394 vendor+province, 375 of 425 vendor)", () => {
    let vp = 0, vpN = 0, v = 0, vN = 0;
    for (const inv of known) {
      const r = withInvoices(refs, known.filter((k) => k.invoiceId !== inv.invoiceId));
      const both = resolveDepartment(null, inv.vendorId, inv.shipToProvince, r);
      const alone = resolveDepartment(null, inv.vendorId, null, r);
      if (both.source === "vendor_province") { vpN++; if (both.departmentId === inv.departmentId) vp++; }
      if (alone.source === "vendor") { vN++; if (alone.departmentId === inv.departmentId) v++; }
    }
    expect({ vp, vpN, v, vN }).toEqual({ vp: 368, vpN: 394, v: 375, vN: 425 });
  });
});

describe("requester", () => {
  it("comes from the PO, else the uploader, else nobody", () => {
    const po = refs.purchaseOrders.get("PO-2026-0046")!;
    expect(resolveRequester(po, "U020")).toBe(po.requesterUserId);
    expect(resolveRequester(null, "U020")).toBe("U020");
    expect(resolveRequester(null, null)).toBeNull();
  });

  it("a terminated requester is replaced by their manager for routing", () => {
    const u015 = refs.users.get("U015")!;
    expect(effectiveRequester("U015", refs)).toBe(u015.managerId);
    expect(effectiveRequester("U020", refs)).toBe("U020");
    expect(effectiveRequester(null, refs)).toBeNull();
  });
});

describe("line type", () => {
  it("history has exactly two mixed accounts, 5020 and 6630", () => {
    const mixed = [...refs.lineTypes.byAccount].filter(([, t]) => t === "mixed").map(([a]) => a).sort();
    expect(mixed).toEqual(["5020", "6630"]);
  });

  it.each([
    ["6110", "Anything at all", "services", "account"],
    ["5020", "Tire service (units)", "services", "description_match"],
    ["9999", "Unknown account", null, null],
    [null, "No account", null, null],
  ])("%s %s → %s", (acct, desc, type, source) => {
    expect(resolveLineType(acct, desc, refs.lineTypes)).toEqual({ lineType: type, source });
  });

  it("reproduces history's line type on every line of a mixed account", () => {
    const lines = ds.invoiceLines.filter((l) => l.glAccount === "5020" || l.glAccount === "6630");
    const right = lines.filter((l) => resolveLineType(l.glAccount, l.description, refs.lineTypes).lineType === l.lineType);
    expect(right.length).toBe(lines.length);
  });
});

describe("currency and FX", () => {
  it.each([
    ["USD", "CA", "USD"],
    [null, "US", "USD"],
    [null, "CA", "CAD"],
    [null, undefined, null],
  ] as const)("printed %s, vendor country %s → %s", (printed, country, want) => {
    expect(resolveCurrency(printed, country)).toBe(want);
  });

  it("uses the invoice date's rate, and the last row after the table ends", () => {
    const row = refs.fxRates.find((r) => r.date === "2026-06-15")!;
    expect(resolveFx("USD", "2026-06-15", refs)).toMatchObject({ rate: row.usdToCad, fallback: false });
    const last = refs.fxRates[refs.fxRates.length - 1];
    expect(resolveFx("USD", "2026-11-20", refs)).toMatchObject({ rate: last.usdToCad, rateDate: last.date, fallback: true });
    expect(resolveFx("CAD", "2026-11-20", refs).rate?.toNumber()).toBe(1);
    expect(resolveFx(null, "2026-11-20", refs).rate).toBeNull();
  });

  it("reproduces history's fx_rate_to_cad on every USD invoice", () => {
    for (const inv of ds.invoices.filter((i) => i.currency === "USD")) {
      expect(resolveFx("USD", inv.invoiceDate, refs).rate?.toFixed(4), inv.invoiceId).toBe(inv.fxRateToCad.toFixed(4));
    }
  });
});

describe("credit note target", () => {
  const inv = ds.invoices.find((i) => i.invoiceId === "AP-00358")!;
  it.each([
    ["same number", inv.vendorInvoiceNumber, [inv.vendorId], inv.invoiceId],
    ["number with extra letters, same digits", `Ref ${inv.vendorInvoiceNumber}`, [inv.vendorId], inv.invoiceId],
    ["no such number", "NO-SUCH-999999", [inv.vendorId], null],
    ["another vendor's number", inv.vendorInvoiceNumber, ["V052"], null],
    ["no reference", null, [inv.vendorId], null],
  ])("%s → %s", (_, ref, vendors, want) => {
    expect(resolveCreditTarget(ref, vendors, refs)).toBe(want);
  });
});

describe("resolveInvoice", () => {
  const base = (over: Partial<NormalizedInvoice>): NormalizedInvoice => ({
    kind: "invoice",
    language: "en",
    fileSha256: "test",
    hasTextLayer: true,
    receivedDate: "2026-10-29",
    emailId: null,
    senderAddress: null,
    senderName: null,
    vendorName: null,
    vendorAddress: null,
    gstHstNumber: null,
    qstNumber: null,
    billToAddress: null,
    invoiceNumber: "X-1",
    numberKey: "X1",
    digitsKey: "1",
    invoiceDate: "2026-10-28",
    dueDate: "2026-11-27",
    terms: null,
    poNumber: null,
    creditNoteRef: null,
    currency: null,
    lines: [{ lineNo: 1, description: "Racking components", quantity: new Decimal(1), unitPrice: new Decimal(5000), amount: new Decimal(5000) }],
    subtotal: new Decimal(5000),
    taxes: [],
    total: new Decimal(5650),
    remit: { institution: null, transit: null, account: null, text: null },
    notes: [],
    evidence: {},
    parseIssues: [],
    extracted: {} as NormalizedInvoice["extracted"],
    ...over,
  });

  it("resolves a known vendor with no PO: suggestions, department from history, CAD", () => {
    const v = refs.vendors.get("V012")!;
    const { invoice } = resolveInvoice(
      base({ vendorName: v.legalName, gstHstNumber: v.gstHstNumber, billToAddress: "88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8" }),
      refs,
    );
    expect(invoice).toMatchObject({
      vendorId: "V012",
      vendorMatchedBy: "tax_number",
      shipToProvince: "ON",
      poId: null,
      poSuggestions: ["PO-2026-0046"],
      currencyResolved: "CAD",
      requesterId: null,
    });
    expect(invoice.totalCad?.toFixed(2)).toBe("5650.00");
    expect(invoice.departmentId).toBeTruthy();
    // Smart coding: "Racking components" at V012 codes to 5030, not the vendor default (5040).
    expect(v.defaultGlAccount).toBe("5040");
    expect(invoice.lines[0]).toMatchObject({ glAccount: "5030", lineType: "goods", lineTypeSource: "account" });
  });

  it("leaves an unknown vendor unresolved, with no department; lines coded by nearest description", () => {
    const { invoice } = resolveInvoice(base({ vendorName: "Blue Heron Couriers" }), refs);
    expect(invoice).toMatchObject({ vendorId: null, departmentId: null, currencyResolved: null, totalCad: null });
    expect(invoice.lines[0]).toMatchObject({ glAccount: "5030", lineType: "goods" });
  });

  it("can be given another line coder", () => {
    const { invoice } = resolveInvoice(base({ vendorName: "Blue Heron Couriers" }), refs, { codeLine: () => null });
    expect(invoice.lines[0]).toMatchObject({ glAccount: null, lineType: null });
  });

  it("takes department and requester from a printed PO", () => {
    const po = refs.purchaseOrders.get("PO-2026-0046")!;
    const v = refs.vendors.get(po.vendorId)!;
    const { invoice } = resolveInvoice(base({ vendorName: v.legalName, poNumber: po.poId }), refs, { uploaderId: "U020" });
    expect(invoice).toMatchObject({ poId: po.poId, departmentId: po.departmentId, requesterId: po.requesterUserId, poSuggestions: [] });
  });
});
