import { randomInt } from "crypto";
import { tx, query } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

const ref = (kind: string) => `BRIM-${kind}-${String(randomInt(10_000_000, 99_999_999))}`;

// Simulated settlement of released payments: EFT settles, a cheque stays outstanding until cleared, a card payment is a virtual card charge.
export async function runBankSimulation(actor: User | null): Promise<number> {
  assertCan(actor, "payment.simulate");
  return tx(async (c) => {
    const released = await query<{ payment_id: string; invoice_id: string; vendor_id: string; method: string }>(
      "SELECT payment_id, invoice_id, vendor_id, method FROM payments WHERE organization_id=$1 AND status='released' FOR UPDATE",
      [actor.organization_id],
      c,
    );
    for (const p of released) {
      const status = p.method === "CHEQUE" ? "outstanding" : "settled";
      const reference = ref(p.method === "EFT" ? "EFT" : p.method === "CHEQUE" ? "CHQ" : "VC");
      await query(
        `UPDATE payments SET status=$2, paid_date=current_date, bank_reference=$3, card_reference=$4 WHERE payment_id=$1`,
        [p.payment_id, status, p.method === "CARD" ? null : reference, p.method === "CARD" ? reference : null],
        c,
      );
      await query("UPDATE invoices SET status='paid' WHERE invoice_id=$1", [p.invoice_id], c);
      await writeAudit(c, {
        organizationId: actor.organization_id, actor, action: `payment.${status}`, entityType: "payment", entityId: p.payment_id,
        invoiceId: p.invoice_id, paymentId: p.payment_id, vendorId: p.vendor_id, note: reference,
      });
    }
    return released.length;
  });
}
