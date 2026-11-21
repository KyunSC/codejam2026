import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import { checkBankChangeRecent, checkBankChangeUnverified, checkBankMismatch } from "../checks/bank";
import type { Refs } from "../refs";
import { fresh, history, inv, refs, refsWith, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Refs, Array<{ code: string; effect: string }>];
const remit = (institution: string | null, transit: string | null, account: string | null) => ({ institution, transit, account, text: null });

describe("BANK_MISMATCH", () => {
  const v = refs.vendors.get("V012")!;
  it.each<Row>([
    ["printed details equal the master", fresh("V012", { remit: remit(v.bankInstitution, v.bankTransit, v.bankAccount) }), refs, []],
    ["account differs", fresh("V012", { remit: remit(v.bankInstitution, v.bankTransit, "99999999") }), refs, [{ code: "BANK_MISMATCH", effect: "hold" }]],
    ["transit differs", fresh("V012", { remit: remit(v.bankInstitution, "00000", v.bankAccount) }), refs, [{ code: "BANK_MISMATCH", effect: "hold" }]],
    ["account only, same", fresh("V012", { remit: remit(null, null, v.bankAccount) }), refs, []],
    ["no remittance printed (card portal)", fresh("V012", { remit: remit(null, null, null) }), refs, []],
    ["unknown vendor", fresh("V012", { vendorId: null, remit: remit("001", "00001", "12345678") }), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkBankMismatch(i, r))).toEqual(want));

  it("a vendor with no bank on file but an account printed is a mismatch", () => {
    const noBank = refs.vendorList.find((x) => !x.bankAccount)!;
    expect(summary(checkBankMismatch(fresh(noBank.vendorId, { remit: remit("001", "00001", "12345678") }), refs))).toEqual([{ code: "BANK_MISMATCH", effect: "hold" }]);
  });

  it("is a fraud flag naming both last fours", () => {
    const [f] = checkBankMismatch(fresh("V012", { remit: remit(null, null, "99999999") }), refs);
    expect(f.klass).toBe("fraud");
    expect(f.message).toContain("…9999");
    expect(f.message).toContain(`…${v.bankAccount!.slice(-4)}`);
  });
});

describe("BANK_CHANGE_UNVERIFIED", () => {
  const known = history.known;
  it.each<Row>([
    ["new V004 invoice after the unverified change (BC-009)", fresh("V004"), refs, [{ code: "BANK_CHANGE_UNVERIFIED", effect: "hold" }]],
    ["AP-00426: approved, unpaid", inv("AP-00426"), refsWith(known, { invoiceId: "AP-00426" }), [{ code: "BANK_CHANGE_UNVERIFIED", effect: "hold" }]],
    ["AP-00388: paid before the change", inv("AP-00388"), refsWith(known, { invoiceId: "AP-00388" }), []],
    ["vendor whose latest change was verified (V026, BC-004)", fresh("V026"), refs, []],
    ["vendor with no bank change", fresh("V012"), refs, []],
    ["before the change was made", fresh("V004"), { ...refs, today: "2026-10-26" }, []],
  ])("%s", (_, i, r, want) => expect(summary(checkBankChangeUnverified(i, r))).toEqual(want));
});

describe("BANK_CHANGE_RECENT", () => {
  it.each<Row>([
    ["V004 invoice 5 days after BC-009", fresh("V004", { invoiceDate: "2026-11-01" }), refs, [{ code: "BANK_CHANGE_RECENT", effect: "info" }]],
    ["exactly 30 days after", fresh("V004", { invoiceDate: "2026-11-26" }), refs, [{ code: "BANK_CHANGE_RECENT", effect: "info" }]],
    ["31 days after", fresh("V004", { invoiceDate: "2026-11-27" }), refs, []],
    ["invoice dated before the change", fresh("V004", { invoiceDate: "2026-10-20" }), refs, []],
    ["vendor with no change", fresh("V012"), refs, []],
  ])("%s", (_, i, r, want) => expect(summary(checkBankChangeRecent(i, r))).toEqual(want));
});

describe("bank checks over history", () => {
  it("BANK_CHANGE_UNVERIFIED fires on exactly AP-00426", () => {
    const status = new Map(history.known.map((k) => [k.invoiceId, k.status]));
    const hits = [...history.resolved].filter(([id, r]) => checkBankChangeUnverified(r, refsWith(history.known, { invoiceId: id, status: status.get(id) })).length);
    expect(hits.map(([id]) => id)).toEqual(["AP-00426"]);
  });

  it("BANK_MISMATCH never fires (history records no remittance)", () => {
    for (const r of history.resolved.values()) expect(checkBankMismatch(r, refs)).toEqual([]);
  });
});
