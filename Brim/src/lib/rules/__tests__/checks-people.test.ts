import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import { checkCreditNoteOrphan, checkRequesterTerminated, checkSelfApproval, checkSplitSuspected, findSplit } from "../checks/people";
import { type KnownInvoice, type Refs, refsAsOf } from "../refs";
import { D, fresh, history, inv, refs, refsWith, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Refs, Array<{ code: string; effect: string }>];

/** A known invoice from V029 on a date, for building a batch. */
const k = (id: string, date: string, totalCad: string, extra: Partial<KnownInvoice> = {}): KnownInvoice => ({
  invoiceId: id,
  kind: "invoice",
  vendorId: "V029",
  invoiceNumber: id,
  numberKey: id.replace(/\W/g, ""),
  digitsKey: id.replace(/\D/g, "").replace(/^0+/, ""),
  invoiceDate: date,
  receivedDate: date,
  dueDate: null,
  currency: "CAD",
  subtotal: D(totalCad),
  total: D(totalCad),
  totalCad: D(totalCad),
  status: "pending_approval",
  poId: null,
  contractId: null,
  departmentId: "D06",
  requesterId: null,
  shipToProvince: "ON",
  lines: [],
  ...extra,
});
const v029 = (n: string, date: string, totalCad: string, over: Partial<ResolvedInvoice> = {}) =>
  fresh("V029", { invoiceNumber: n, numberKey: n, digitsKey: n.replace(/\D/g, ""), invoiceDate: date, total: D(totalCad), totalCad: D(totalCad), ...over });

describe("SPLIT_SUSPECTED", () => {
  const batch = [k("281", "2026-10-28", "4847.70"), k("287", "2026-10-28", "4847.70")];
  it.each<Row>([
    ["third of three on one day, $14,543.10 together", v029("29", "2026-10-28", "4847.70"), refsWith(batch), [{ code: "SPLIT_SUSPECTED", effect: "route" }]],
    ["two that stay under $10,000", v029("29", "2026-10-28", "4000.00"), refsWith(batch.slice(0, 1)), []],
    ["six days apart", v029("29", "2026-11-03", "6000.00"), refsWith(batch), []],
    ["this one is already over the threshold", v029("29", "2026-10-28", "10500.00"), refsWith(batch), []],
    ["different requesters, both known", v029("29", "2026-10-28", "6000.00", { requesterId: "U030" }), refsWith([k("281", "2026-10-28", "6000.00", { requesterId: "U031" })]), []],
    ["the earlier one is a copy (same number)", v029("281", "2026-10-28", "6000.00"), refsWith([k("281", "2026-10-28", "6000.00")]), []],
    ["the earlier one is a reformatted copy (same digits and total)", v029("A-281", "2026-10-28", "6000.00"), refsWith([k("281", "2026-10-28", "6000.00")]), []],
    ["the earlier one was rejected", v029("29", "2026-10-28", "6000.00"), refsWith([k("281", "2026-10-28", "6000.00", { status: "rejected" })]), []],
  ])("%s", (_, i, r, want) => expect(summary(checkSplitSuspected(i, r))).toEqual(want));

  it("reports the combined amount for routing", () => {
    const g = findSplit(v029("29", "2026-10-28", "4847.70"), refsWith(batch))!;
    expect(g.combinedCad.toFixed(2)).toBe("14543.10");
    expect(g.threshold).toBe(10_000);
  });

  it("over history flags exactly the two planted groups, with the planted totals", () => {
    const hits: string[] = [];
    for (const [known, r] of refsAsOf(refs, history.known)) {
      const g = findSplit(history.resolved.get(known.invoiceId)!, r);
      if (g) hits.push(`${[...g.members.map((m) => m.invoiceId), known.invoiceId].join("/")} ${g.combinedCad.toFixed(2)}`);
    }
    expect(hits).toEqual(["AP-00129/AP-00131 14236.36", "AP-00200/AP-00206/AP-00207 14070.00"]);
  });
});

describe("REQUESTER_TERMINATED", () => {
  it.each<Row>([
    ["U015 terminated 2026-09-15, invoice received after", fresh("V012", { requesterId: "U015", receivedDate: "2026-10-29" }), refs, [{ code: "REQUESTER_TERMINATED", effect: "info" }]],
    ["U015 before termination", fresh("V012", { requesterId: "U015", receivedDate: "2026-09-05" }), refs, []],
    ["active requester", fresh("V012", { requesterId: "U020" }), refs, []],
    ["no requester", fresh("V012", { requesterId: null }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkRequesterTerminated(i, r))).toEqual(want));

  it("names the manager who takes over", () => {
    const mgr = refs.users.get(refs.users.get("U015")!.managerId!)!;
    expect(checkRequesterTerminated(fresh("V012", { requesterId: "U015", receivedDate: "2026-10-29" }), refs)[0].message).toContain(mgr.userId);
  });
});

describe("SELF_APPROVAL (history)", () => {
  it.each<Row>([
    ["AP-00092: U010 approved own request", inv("AP-00092"), refsWith([], { invoiceId: "AP-00092" }), [{ code: "SELF_APPROVAL", effect: "info" }]],
    ["AP-00001: approved by someone else", inv("AP-00001"), refsWith([], { invoiceId: "AP-00001" }), []],
    ["new invoice, no approvals yet", fresh("V012", { requesterId: "U010" }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkSelfApproval(i, r))).toEqual(want));

  it("over history fires on exactly AP-00092, AP-00178, AP-00235 (all U010)", () => {
    const hits = [...history.resolved].filter(([id, r]) => checkSelfApproval(r, refsWith([], { invoiceId: id })).length).map(([id]) => id);
    expect(hits).toEqual(["AP-00092", "AP-00178", "AP-00235"]);
  });
});

describe("CREDIT_NOTE_ORPHAN", () => {
  it.each<Row>([
    ["credit note linked to its invoice", fresh("V002", { kind: "credit_note", creditNoteRef: "X", creditOfInvoiceId: "AP-00358" }), refs, []],
    ["credit note matching nothing", fresh("V002", { kind: "credit_note", creditNoteRef: "NOPE-1", creditOfInvoiceId: null }), refs, [{ code: "CREDIT_NOTE_ORPHAN", effect: "hold" }]],
    ["credit note with no reference", fresh("V002", { kind: "credit_note", creditNoteRef: null, creditOfInvoiceId: null }), refs, [{ code: "CREDIT_NOTE_ORPHAN", effect: "hold" }]],
    ["ordinary invoice", fresh("V002"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkCreditNoteOrphan(i, r))).toEqual(want));
});
