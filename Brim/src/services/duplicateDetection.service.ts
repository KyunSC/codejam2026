import { query } from "@/lib/db";
import { invoiceNumberCore } from "@/lib/normalize";
import { cardChargesFor } from "./cardFeed.service";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./checks/types";

type Candidate = { ref: string; is_invoice: boolean; vendor_id: string | null; number: string | null; total: number | null; invoice_date: string | null; sha256: string | null; status: string };

// Step 5: five layers, searched across the invoices and the other parsed invoices.
export async function detectDuplicates(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, db } = ctx;
  const flags: Flag[] = [];
  const candidates = await query<Candidate>(
    `SELECT i.invoice_id AS ref, true AS is_invoice, i.vendor_id, i.vendor_invoice_number AS number, i.total, i.invoice_date::text, p.sha256, i.status
       FROM invoices i LEFT JOIN parsed_invoices p ON p.parsed_invoice_id = i.parsed_invoice_id
      WHERE i.organization_id=$1 AND (i.vendor_id=$2 OR p.sha256=$3) AND i.status <> 'void'
     UNION ALL
     SELECT p.parsed_invoice_id, false, p.invoice_json->>'vendor_id', p.invoice_json->>'vendor_invoice_number', (p.invoice_json->>'total')::numeric,
            p.invoice_json->>'invoice_date', p.sha256, p.status
       FROM parsed_invoices p
      WHERE p.organization_id=$1 AND p.parsed_invoice_id<>$4 AND p.status='pending'
        AND (p.invoice_json->>'vendor_id'=$2 OR p.sha256=$3)`,
    [ctx.organizationId, d.vendor_id ?? "", ctx.sha256 ?? "", ctx.parsedInvoiceId],
    db,
  );
  const seen = new Set<string>();
  const add = (c: Candidate, code: string, message: string) => {
    if (seen.has(c.ref)) return;
    seen.add(c.ref);
    flags.push({ check_code: code, category: "duplicate", severity: "blocking", message, related_invoice_id: c.is_invoice ? c.ref : undefined, evidence: { other: c.ref, status: c.status } });
  };
  const sameTotal = (c: Candidate) => c.total != null && d.total != null && Math.abs(Number(c.total) - d.total) < 0.005;
  const label = (c: Candidate) => `${c.ref}${c.is_invoice ? ` (${c.status})` : " (parsed, pending)"}`;

  for (const c of candidates) if (ctx.sha256 && c.sha256 === ctx.sha256) add(c, "duplicate_file", `Same file as ${label(c)}.`);
  if (d.vendor_id) {
    for (const c of candidates) {
      if (c.vendor_id !== d.vendor_id) continue;
      if (d.vendor_invoice_number && c.number === d.vendor_invoice_number) add(c, "duplicate_number", `Same vendor and invoice number ${c.number} as ${label(c)}.`);
    }
    const core = invoiceNumberCore(d.vendor_invoice_number);
    for (const c of candidates) {
      if (c.vendor_id !== d.vendor_id || !sameTotal(c) || !core) continue;
      if (invoiceNumberCore(c.number) === core) add(c, "duplicate_near_number", `Invoice ${d.vendor_invoice_number} matches ${c.number} on ${label(c)}, same vendor and total ${money(d.total)}.`);
    }
    for (const c of candidates) {
      if (c.vendor_id !== d.vendor_id || !sameTotal(c)) continue;
      if (d.invoice_date && c.invoice_date === d.invoice_date) add(c, "duplicate_content", `Same vendor, date ${d.invoice_date} and total ${money(d.total)} as ${label(c)}, under number ${c.number}.`);
    }
  }
  if (d.vendor_name && d.total && d.invoice_date) {
    for (const t of cardChargesFor(d.vendor_name, d.total, d.invoice_date)) {
      flags.push({
        check_code: "paid_by_card",
        category: "duplicate",
        severity: "blocking",
        message: `Already paid by card: ${t.txn_id} on ${t.posted_date}, ${t.merchant_descriptor}, ${money(t.amount)}, card ${t.card_id}.`,
        related_card_txn_ref: t.txn_id,
        evidence: { txn: t },
      });
    }
  }
  return flags;
}
