import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import { checkPoClosed, checkPoNotFound, checkPoOverBalance, checkPoRequiredMissing, checkPoVendorMismatch } from "../checks/po";
import type { Refs } from "../refs";
import { D, fresh, history, inv, refs, refsWith, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Refs, Array<{ code: string; effect: string }>];
const before = (id: string) => {
  const at = history.known.find((k) => k.invoiceId === id)!;
  return refsWith(
    history.known.filter((k) => k.receivedDate < at.receivedDate || (k.receivedDate === at.receivedDate && k.invoiceId < id)),
    { invoiceId: id, status: at.status },
  );
};

describe("PO_REQUIRED_MISSING", () => {
  it.each<Row>([
    ["V012 requires a PO, none printed; PO-2026-0046 fits", fresh("V012", { poSuggestions: ["PO-2026-0046"] }), refs, [{ code: "PO_REQUIRED_MISSING", effect: "hold" }]],
    ["V014 requires a PO, no open PO", fresh("V014"), refs, [{ code: "PO_REQUIRED_MISSING", effect: "hold" }]],
    ["PO printed", fresh("V012", { poNumber: "PO-2026-0046", poId: "PO-2026-0046" }), refs, []],
    ["vendor does not require a PO", fresh("V004"), refs, []],
    ["credit note", fresh("V012", { kind: "credit_note" }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkPoRequiredMissing(i, r))).toEqual(want));

  it("names the suggested PO, or says none fits", () => {
    expect(checkPoRequiredMissing(fresh("V012", { poSuggestions: ["PO-2026-0046"] }), refs)[0].message).toMatch(/PO-2026-0046/);
    expect(checkPoRequiredMissing(fresh("V014"), refs)[0].message).toMatch(/No open PO/);
  });

  it("over history fires on exactly the three split invoices with no PO", () => {
    const hits = [...history.resolved].filter(([, r]) => checkPoRequiredMissing(r, refs).length).map(([id]) => id);
    expect(hits).toEqual(["AP-00200", "AP-00206", "AP-00207"]);
  });
});

describe("PO_NOT_FOUND", () => {
  it.each<Row>([
    ["printed PO does not exist", fresh("V012", { poNumber: "PO-2099-0001", poId: null }), refs, [{ code: "PO_NOT_FOUND", effect: "hold" }]],
    ["printed PO exists", fresh("V012", { poNumber: "PO 2026 0046", poId: null }), refs, []],
    ["no PO printed", fresh("V012"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkPoNotFound(i, r))).toEqual(want));
});

describe("PO_VENDOR_MISMATCH", () => {
  it.each<Row>([
    ["V012's PO on a V010 invoice", fresh("V010", { poNumber: "PO-2026-0046", poId: "PO-2026-0046" }), refs, [{ code: "PO_VENDOR_MISMATCH", effect: "hold" }]],
    ["own PO", fresh("V012", { poNumber: "PO-2026-0046", poId: "PO-2026-0046" }), refs, []],
    ["no PO", fresh("V012"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkPoVendorMismatch(i, r))).toEqual(want));
});

describe("PO_CLOSED", () => {
  const closed = [...refs.purchaseOrders.values()].find((p) => p.status === "closed")!;
  it.each<Row>([
    ["closed PO", fresh(closed.vendorId, { poNumber: closed.poId, poId: closed.poId }), refs, [{ code: "PO_CLOSED", effect: "hold" }]],
    ["open PO", fresh("V012", { poNumber: "PO-2026-0046", poId: "PO-2026-0046" }), refs, []],
    ["partially invoiced PO", fresh("V044", { poNumber: "PO-2026-0037", poId: "PO-2026-0037" }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkPoClosed(i, r))).toEqual(want));
});

describe("PO_OVER_BALANCE", () => {
  it.each<Row>([
    ["AP-00159: $2,600.00 on a $2,321.43 PO", inv("AP-00159"), before("AP-00159"), [{ code: "PO_OVER_BALANCE", effect: "route" }]],
    ["AP-00216: $3,100.00 on a $2,767.86 PO", inv("AP-00216"), before("AP-00216"), [{ code: "PO_OVER_BALANCE", effect: "route" }]],
    ["AP-00224: second bill on PO-2026-0027", inv("AP-00224"), before("AP-00224"), [{ code: "PO_OVER_BALANCE", effect: "route" }]],
    ["AP-00215: first bill on PO-2026-0027", inv("AP-00215"), before("AP-00215"), []],
    ["V044 $2,150.00 against $1,800.00 left on PO-2026-0037", fresh("V044", { poId: "PO-2026-0037", poNumber: "PO-2026-0037", subtotal: D("2150.00") }), refs, [{ code: "PO_OVER_BALANCE", effect: "route" }]],
    ["V044 $1,800.00 exactly the balance", fresh("V044", { poId: "PO-2026-0037", poNumber: "PO-2026-0037", subtotal: D("1800.00") }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkPoOverBalance(i, r))).toEqual(want));

  it("over history (each invoice against the ones before it) fires on the two planted plus the two double-billed POs", () => {
    const hits = [...history.resolved].filter(([id, r]) => checkPoOverBalance(r, before(id)).length).map(([id]) => id);
    expect(hits).toEqual(["AP-00159", "AP-00216", "AP-00224", "AP-00407"]);
  });
});
