import { readdirSync, existsSync } from "fs";
import path from "path";
import { readCsv } from "@/lib/csv";
import { tx, query, one, type Db } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

// A line as the bank or the card feed reports it, with what it is.
export type StatementLine = {
  line_id: string; source: "bank" | "card"; posted_date: string; description: string; amount: number;
  kind: "eft" | "cheque" | "card" | "other"; reference: string | null;
};

// A bank statement row: an EFT payment ends with the last 6 digits of the payment's reference; a cheque clears by its number.
export function bankLine(r: Record<string, string>): StatementLine {
  const eft = r.description.match(/^EFT PMT .* (\d{6})$/);
  const cheque = r.description.match(/^CHEQUE (\d+) CLEARED$/);
  return {
    line_id: r.bank_txn_id, source: "bank", posted_date: r.posted_date, description: r.description.replace(/\s+/g, " ").trim(),
    amount: Number(r.debit || 0) - Number(r.credit || 0),
    kind: eft ? "eft" : cheque ? "cheque" : "other", reference: eft?.[1] ?? cheque?.[1] ?? null,
  };
}

// A card feed row: only the virtual card a payment is made with is a payment; employee card spending is not.
export function cardLine(r: Record<string, string>): StatementLine | null {
  if (r.source !== "ap_virtual_card") return null;
  return {
    line_id: r.txn_id, source: "card", posted_date: r.posted_date, description: [r.merchant_descriptor, r.memo].filter(Boolean).join(" · "),
    amount: Number(r.amount_cad), kind: "card", reference: r.card_id,
  };
}

export async function insertLine(db: Db, organizationId: string, l: StatementLine) {
  const r = await query<{ line_id: string }>(
    `INSERT INTO statement_lines (line_id, organization_id, source, posted_date, description, amount, kind, reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (line_id) DO NOTHING RETURNING line_id`,
    [l.line_id, organizationId, l.source, l.posted_date, l.description, l.amount, l.kind, l.reference],
    db,
  );
  return r.length > 0;
}

// The bank's files: statement lines in BANK_DIR/statements, virtual card charges in BANK_DIR/card.
function readBankFiles(): StatementLine[] {
  const dir = process.env.BANK_DIR!;
  const csvs = (sub: string) => {
    const d = path.join(dir, sub);
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".csv")).sort().flatMap((f) => readCsv(path.join(d, f))) : [];
  };
  return [...csvs("statements").map(bankLine), ...csvs("card").map(cardLine).filter((l): l is StatementLine => !!l)];
}

// Imports what the bank reported since the last import, then settles every payment a line confirms: an EFT by its reference and amount,
// a cheque by its number, a card payment by the virtual card made for its invoice. The invoice is then paid.
export async function importStatement(actor: User | null): Promise<{ lines: number; settled: number }> {
  assertCan(actor, "payment.reconcile");
  const organizationId = actor.organization_id!;
  const lines = readBankFiles();
  return tx(async (c) => {
    let added = 0;
    for (const l of lines) if (await insertLine(c, organizationId, l)) added++;

    const open = await query<{ line_id: string; posted_date: string; amount: number; kind: string; reference: string }>(
      "SELECT line_id, posted_date::text, amount::float, kind, reference FROM statement_lines WHERE organization_id=$1 AND payment_id IS NULL AND kind<>'other' ORDER BY posted_date, line_id",
      [organizationId],
      c,
    );
    let settled = 0;
    for (const l of open) {
      const pay = await one<{ payment_id: string; invoice_id: string; vendor_id: string }>(
        l.kind === "eft"
          ? "SELECT payment_id, invoice_id, vendor_id FROM payments WHERE organization_id=$1 AND method='EFT' AND status='released' AND right(bank_reference, 6)=$2 AND amount_cad=$3"
          : l.kind === "cheque"
            ? "SELECT payment_id, invoice_id, vendor_id FROM payments WHERE organization_id=$1 AND method='CHEQUE' AND status='outstanding' AND cheque_number=$2::int AND amount_cad=$3"
            : "SELECT payment_id, invoice_id, vendor_id FROM payments WHERE organization_id=$1 AND method='CARD' AND status='released' AND 'VC-' || invoice_id=$2 AND amount_cad=$3",
        [organizationId, l.reference, l.amount],
        c,
      );
      if (!pay) continue;
      await query("UPDATE payments SET status='settled', paid_date=$2 WHERE payment_id=$1", [pay.payment_id, l.posted_date], c);
      await query("UPDATE statement_lines SET payment_id=$2 WHERE line_id=$1", [l.line_id, pay.payment_id], c);
      await query("UPDATE invoices SET status='paid' WHERE invoice_id=$1", [pay.invoice_id], c);
      await writeAudit(c, {
        organizationId, actor, action: "payment.settled", entityType: "payment", entityId: pay.payment_id,
        invoiceId: pay.invoice_id, paymentId: pay.payment_id, vendorId: pay.vendor_id, note: l.line_id,
      });
      settled++;
    }
    return { lines: added, settled };
  });
}
