/**
 * Bank reconciliation matching (BUILD_PLAN Bonus → Bank reconciliation). Pure: statement lines and
 * payments in, matches and leftovers out. In order:
 *   1. `EFT PMT … NNNNNN`: the last 6 digits equal the last 6 of an EFT payment's reference, amount equal, else
 *      within `eftAmountTolerance` (history: 3 lines are one cent off their payment), noted.
 *   2. `CHEQUE NNNN CLEARED`: cheque payments by amount, earliest unmatched first, cleared on or after the
 *      paid date (the number on the line is the bank's, not ours). Line by line in posting order: the exact
 *      amount if any, else within `chequeAmountTolerance`, noted as "amount differs by $x".
 *   3. `MONTHLY ACCOUNT FEE`, `WIRE FEE`: no payment; bank fees to the fee account.
 *   4. Anything else (e.g. `PREAUTH DEBIT NNNNNN`): no payment and no rule, unexplained, needs a person.
 * Also: EFT and cheque payments with no line, and cheques the ledger calls sent that the bank has cleared.
 */
import Decimal from "decimal.js";
import { config } from "@/lib/config";

export interface StatementLineIn {
  id: string;
  postedDate: string; // YYYY-MM-DD
  description: string;
  debit: string | null;
  credit: string | null;
}

export interface PaymentIn {
  id: string;
  invoiceId: string;
  vendorId: string;
  method: string;
  status: string;
  reference: string | null;
  amount: string;
  paidDate: string | null;
  scheduledDate: string;
}

export interface Match {
  lineId: string;
  paymentId: string;
  kind: "eft" | "cheque";
  note: string | null;
}

export interface Reconciliation {
  matches: Match[];
  fees: Array<{
    lineId: string;
    kind: "monthly" | "wire";
    account: string;
    amount: string;
  }>;
  unexplained: Array<{ lineId: string; reason: string }>;
  paymentsWithoutLine: Array<{
    paymentId: string;
    reason: string;
    expected: boolean;
  }>;
  /** Cheques still `sent` in the ledger whose clearing line is on the statement. */
  clearedButOutstanding: Array<{ paymentId: string; lineId: string }>;
}

const EFT = /^EFT PMT .* (\d{6})$/;
const CHEQUE = /^CHEQUE \d+ CLEARED$/;
const FEES: Array<[RegExp, "monthly" | "wire"]> = [
  [/^MONTHLY ACCOUNT FEE$/, "monthly"],
  [/^WIRE FEE$/, "wire"],
];
const PAID = new Set(["sent", "settled", "released"]);

const last6 = (ref: string | null) => (ref ?? "").replace(/\D/g, "").slice(-6);
const amt = (l: StatementLineIn) => new Decimal(l.debit ?? l.credit ?? 0);

export function reconcile(
  lines: readonly StatementLineIn[],
  payments: readonly PaymentIn[],
): Reconciliation {
  const ordered = [...lines].sort(
    (a, b) =>
      a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id),
  );
  const used = new Set<string>();
  const out: Reconciliation = {
    matches: [],
    fees: [],
    unexplained: [],
    paymentsWithoutLine: [],
    clearedButOutstanding: [],
  };
  const handled = new Set<string>();

  // 1. EFT by reference and amount.
  const eftByLast6 = new Map<string, PaymentIn[]>();
  for (const p of payments)
    if (p.method === "EFT" && p.reference)
      eftByLast6.set(last6(p.reference), [
        ...(eftByLast6.get(last6(p.reference)) ?? []),
        p,
      ]);
  for (const l of ordered) {
    const m = l.description.trim().match(EFT);
    if (!m) continue;
    const cands = (eftByLast6.get(m[1]) ?? []).filter((x) => !used.has(x.id));
    const diffOf = (x: PaymentIn) => amt(l).minus(x.amount).abs();
    const p =
      cands.find((x) => diffOf(x).isZero()) ??
      cands.find((x) =>
        diffOf(x).lte(config.reconciliation.eftAmountTolerance),
      );
    if (!p) continue;
    used.add(p.id);
    handled.add(l.id);
    const d = diffOf(p);
    out.matches.push({
      lineId: l.id,
      paymentId: p.id,
      kind: "eft",
      note: d.isZero() ? null : `amount differs by $${d.toFixed(2)}`,
    });
  }

  // 2. Cheques: exact amount pass, then within tolerance.
  const cheques = payments
    .filter((p) => p.method === "CHEQUE" && p.paidDate)
    .sort(
      (a, b) =>
        a.paidDate!.localeCompare(b.paidDate!) || a.id.localeCompare(b.id),
    );
  const chequeLines = ordered.filter((l) => CHEQUE.test(l.description.trim()));
  // Line by line in posting order: the earliest unmatched cheque of the exact amount, else within tolerance.
  for (const l of chequeLines) {
    {
      const a = amt(l);
      const open = cheques.filter(
        (x) => !used.has(x.id) && x.paidDate! <= l.postedDate,
      );
      const diff = (x: PaymentIn) => new Decimal(x.amount).minus(a).abs();
      const p =
        open.find((x) => diff(x).isZero()) ??
        open.find((x) =>
          diff(x).lte(config.reconciliation.chequeAmountTolerance),
        );
      if (!p) continue;
      used.add(p.id);
      handled.add(l.id);
      const off = diff(p);
      out.matches.push({
        lineId: l.id,
        paymentId: p.id,
        kind: "cheque",
        note: off.isZero() ? null : `amount differs by $${off.toFixed(2)}`,
      });
      if (p.status === "sent")
        out.clearedButOutstanding.push({ paymentId: p.id, lineId: l.id });
    }
  }

  // 3–4. Fees, then whatever is left.
  for (const l of ordered) {
    if (handled.has(l.id)) continue;
    const fee = FEES.find(([re]) => re.test(l.description.trim()));
    if (fee)
      out.fees.push({
        lineId: l.id,
        kind: fee[1],
        account: config.reconciliation.feeAccount,
        amount: amt(l).toFixed(2),
      });
    else if (EFT.test(l.description.trim()))
      out.unexplained.push({
        lineId: l.id,
        reason: "EFT line with no payment of this reference and amount",
      });
    else if (CHEQUE.test(l.description.trim()))
      out.unexplained.push({
        lineId: l.id,
        reason:
          "cleared cheque with no unmatched cheque payment of this amount",
      });
    else
      out.unexplained.push({
        lineId: l.id,
        reason: "no payment and no rule for this line",
      });
  }

  // Payments with no line.
  for (const p of payments) {
    if (used.has(p.id) || (p.method !== "EFT" && p.method !== "CHEQUE"))
      continue;
    if (p.status === "scheduled" || p.status === "released")
      out.paymentsWithoutLine.push({
        paymentId: p.id,
        reason: `${p.status}, not sent yet`,
        expected: true,
      });
    else if (p.status === "failed")
      out.paymentsWithoutLine.push({
        paymentId: p.id,
        reason: "failed, never left the bank",
        expected: true,
      });
    else if (PAID.has(p.status))
      out.paymentsWithoutLine.push({
        paymentId: p.id,
        reason:
          p.method === "CHEQUE"
            ? "cheque sent, not cleared yet"
            : `${p.status} but not on the statement`,
        expected: p.method === "CHEQUE",
      });
  }
  return out;
}
