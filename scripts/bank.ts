// The bank and the card processor, outside the app. Reads the payment instructions the app left in BANK_DIR/outbox and, for each one
// due by the business date, answers the way the bank does: an EFT appears on the statement with the last 6 digits of its reference,
// a cheque appears when it clears, a card payment appears as a charge on the virtual card made for the invoice.
// The app reads these with "Import bank statement". Usage: npx tsx scripts/bank.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

process.loadEnvFile(path.join(import.meta.dirname, "../.env.local"));
const DIR = process.env.BANK_DIR;
if (!DIR) throw new Error("Set BANK_DIR in .env.local");
const today = process.env.AS_OF_DATE || new Date().toLocaleDateString("en-CA");

type Instruction = {
  payment_id: string; invoice_id: string; method: "EFT" | "CHEQUE" | "CARD"; scheduled_date: string | null; currency: string; amount: number;
  amount_cad: number; vendor: string; reference: string; cheque_number: number | null; card_id: string | null; released_by: string;
};

const outbox = path.join(DIR, "outbox");
const done = path.join(outbox, "done");
mkdirSync(done, { recursive: true });
const due = (existsSync(outbox) ? readdirSync(outbox) : [])
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, i: JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as Instruction }))
  .filter(({ i }) => !i.scheduled_date || i.scheduled_date <= today);

const cell = (v: string | number | null) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const row = (vs: (string | number | null)[]) => vs.map(cell).join(",");
const stamp = today.replace(/-/g, "");
const statement: string[] = [];
const card: string[] = [];
for (const [n, { i }] of due.entries()) {
  const id = `${stamp}-${String(n + 1).padStart(3, "0")}-${i.payment_id}`;
  if (i.method === "CARD") {
    card.push(row([`CT-${id}`, i.card_id, i.released_by, today, i.vendor.toUpperCase(), "", i.amount.toFixed(2), i.currency, i.amount_cad.toFixed(2), "ap_virtual_card", "yes", `AP payment ${i.invoice_id}`]));
  } else {
    const description = i.method === "EFT" ? `EFT PMT ${i.vendor.toUpperCase().slice(0, 25)} ${i.reference.slice(-6)}` : `CHEQUE ${i.cheque_number} CLEARED`;
    statement.push(row([`BK-${id}`, today, description, i.amount_cad.toFixed(2), ""]));
  }
}
const write = (sub: string, header: string, lines: string[]) => {
  if (!lines.length) return;
  mkdirSync(path.join(DIR, sub), { recursive: true });
  writeFileSync(path.join(DIR, sub, `${sub}-${stamp}-${Date.now()}.csv`), [header, ...lines].join("\n") + "\n");
};
write("statements", "bank_txn_id,posted_date,description,debit,credit", statement);
write("card", "txn_id,card_id,cardholder_user_id,posted_date,merchant_descriptor,mcc,amount,currency,amount_cad,source,receipt_attached,memo", card);
for (const { file } of due) renameSync(path.join(outbox, file), path.join(done, file));
console.log(`${statement.length} statement line${statement.length === 1 ? "" : "s"}, ${card.length} card charge${card.length === 1 ? "" : "s"}; ${due.length} of the instructions were due by ${today}.`);
