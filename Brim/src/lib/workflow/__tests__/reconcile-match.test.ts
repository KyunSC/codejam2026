import { describe, expect, it } from "vitest";
import { loadDataset } from "@/lib/dataset";
import { type PaymentIn, reconcile, type StatementLineIn } from "../reconcile-match";

const ds = loadDataset();
const lines: StatementLineIn[] = ds.bankStatement.map((l) => ({
  id: l.bankTxnId, postedDate: l.postedDate, description: l.description, debit: l.debit?.toString() ?? null, credit: l.credit?.toString() ?? null,
}));
// The CSV's "outstanding" cheques are stored as "sent" in the app.
const payments: PaymentIn[] = ds.payments.map((p) => ({
  id: p.paymentId, invoiceId: p.invoiceId, vendorId: p.vendorId, method: p.method, status: p.status === "outstanding" ? "sent" : p.status,
  reference: p.reference, amount: p.amount.toString(), paidDate: p.paidDate, scheduledDate: p.scheduledDate,
}));

describe("bank reconciliation over history (BUILD_PLAN Bonus)", () => {
  const r = reconcile(lines, payments);

  it("EFT: 313 of 313 by last 6 of the reference and amount; 3 are one cent off (the dataset, not BUILD_PLAN)", () => {
    const eft = r.matches.filter((m) => m.kind === "eft");
    expect(eft).toHaveLength(313);
    expect(eft.filter((m) => m.note).map((m) => [m.lineId, m.note])).toEqual([
      ["BK-00121", "amount differs by $0.01"],
      ["BK-00190", "amount differs by $0.01"],
      ["BK-00230", "amount differs by $0.01"],
    ]);
  });

  it("cheques: 19 exact and 1 at $6,990.53 against $6,990.48", () => {
    const ch = r.matches.filter((m) => m.kind === "cheque");
    expect(ch).toHaveLength(20);
    expect(ch.filter((m) => m.note === null)).toHaveLength(19);
    const near = ch.find((m) => m.note);
    expect(near).toMatchObject({ lineId: "BK-00296", note: "amount differs by $0.05" });
  });

  it("cheques clear on or after they were paid, earliest unmatched first", () => {
    const byId = new Map(payments.map((p) => [p.id, p]));
    const byLine = new Map(lines.map((l) => [l.id, l]));
    for (const m of r.matches.filter((x) => x.kind === "cheque")) expect(byId.get(m.paymentId)!.paidDate! <= byLine.get(m.lineId)!.postedDate).toBe(true);
    const first = r.matches.find((m) => m.lineId === "BK-00006")!;
    expect(first.paymentId).toBe("PAY-00005");
  });

  it("fees: 10 monthly and 6 wire, to account 7010", () => {
    expect(r.fees.filter((f) => f.kind === "monthly")).toHaveLength(10);
    expect(r.fees.filter((f) => f.kind === "wire")).toHaveLength(6);
    expect(new Set(r.fees.map((f) => f.account))).toEqual(new Set(["7010"]));
  });

  it("5 PREAUTH debits unexplained", () => {
    expect(r.unexplained).toHaveLength(5);
    const desc = new Map(lines.map((l) => [l.id, l.description]));
    expect(r.unexplained.every((u) => desc.get(u.lineId)!.startsWith("PREAUTH DEBIT"))).toBe(true);
  });

  it("payments with no line: 13 scheduled EFTs and 2 scheduled cheques; 20 outstanding cheques cleared", () => {
    const byId = new Map(payments.map((p) => [p.id, p]));
    const none = r.paymentsWithoutLine.map((x) => byId.get(x.paymentId)!);
    expect(none.filter((p) => p.method === "EFT" && p.status === "scheduled")).toHaveLength(13);
    expect(none.filter((p) => p.method === "CHEQUE" && p.status === "scheduled")).toHaveLength(2);
    expect(none).toHaveLength(15);
    expect(r.clearedButOutstanding).toHaveLength(20);
  });

  it("every line is accounted for exactly once", () => {
    const ids = [...r.matches.map((m) => m.lineId), ...r.fees.map((f) => f.lineId), ...r.unexplained.map((u) => u.lineId)];
    expect(ids.length).toBe(lines.length);
    expect(new Set(ids).size).toBe(lines.length);
  });
});

describe("reconcile edge cases", () => {
  const p = (o: Partial<PaymentIn>): PaymentIn => ({ id: "P1", invoiceId: "I1", vendorId: "V1", method: "EFT", status: "settled", reference: "BRIM-EFT-90000001", amount: "100.00", paidDate: "2026-11-01", scheduledDate: "2026-11-01", ...o });
  const l = (o: Partial<StatementLineIn>): StatementLineIn => ({ id: "L1", postedDate: "2026-11-02", description: "EFT PMT ACME 000001", debit: "100.00", credit: null, ...o });

  it("an EFT line a cent off its payment matches with a note; further off does not", () => {
    expect(reconcile([l({ debit: "100.01" })], [p({})]).matches).toEqual([{ lineId: "L1", paymentId: "P1", kind: "eft", note: "amount differs by $0.01" }]);
    const r = reconcile([l({ debit: "100.10" })], [p({})]);
    expect(r.matches).toEqual([]);
    expect(r.unexplained[0].reason).toMatch(/EFT line/);
    expect(r.paymentsWithoutLine[0]).toMatchObject({ paymentId: "P1", expected: false });
  });

  it("a cheque that clears before it was paid is not matched", () => {
    const r = reconcile([l({ description: "CHEQUE 5001 CLEARED", postedDate: "2026-10-01" })], [p({ method: "CHEQUE", status: "sent" })]);
    expect(r.matches).toEqual([]);
  });

  it("a cheque more than the tolerance off is not matched", () => {
    const r = reconcile([l({ description: "CHEQUE 5001 CLEARED", debit: "101.00" })], [p({ method: "CHEQUE", status: "sent" })]);
    expect(r.matches).toEqual([]);
    expect(r.paymentsWithoutLine[0].reason).toMatch(/not cleared/);
  });
});
