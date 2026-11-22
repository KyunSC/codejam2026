import path from "path";
import { readCsv } from "@/lib/csv";
import { allowedEdits, levenshtein } from "@/lib/normalize";

export type CardTxn = {
  txn_id: string;
  card_id: string;
  cardholder_user_id: string;
  posted_date: string;
  merchant_descriptor: string;
  amount: number;
  currency: string;
  source: string;
};

let txns: CardTxn[] | null = null;

function load() {
  txns ??= readCsv(path.join(process.env.FEEDS_DIR!, "data", "card_transactions.csv")).map((r) => ({
    txn_id: r.txn_id,
    card_id: r.card_id,
    cardholder_user_id: r.cardholder_user_id,
    posted_date: r.posted_date,
    merchant_descriptor: r.merchant_descriptor,
    amount: parseFloat(r.amount),
    currency: r.currency,
    source: r.source,
  }));
  return txns;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Employee-card charges whose merchant matches the vendor and whose amount equals the invoice total. The merchant descriptor is
// often cut short, so it matches when it and the vendor name agree over the shorter one's length, give or take a few letters.
export function cardChargesFor(vendorName: string, amount: number, onOrAfter: string): CardTxn[] {
  const v = norm(vendorName);
  return load().filter((t) => {
    if (t.source !== "employee_card") return false;
    if (Math.abs(t.amount - amount) > 0.005) return false;
    if (t.posted_date < onOrAfter) return false;
    const m = norm(t.merchant_descriptor);
    const n = Math.min(m.length, v.length);
    return m.length >= 8 && levenshtein(m.slice(0, n), v.slice(0, n)) <= allowedEdits(m.slice(0, n), v.slice(0, n));
  });
}
