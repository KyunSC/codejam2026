import { tx, query, one, nextId, PoolClientLike } from "@/lib/db";
import { assertCan, ForbiddenError } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { invoiceNumberCore } from "@/lib/normalize";
import type { InvoiceData, User } from "@/lib/types";
import { getParsed, resolveAndCheck } from "./pipeline.service";
import { getRawItem } from "./rawIntake.service";
import { startApprovalChain } from "./approvalRouting.service";

const HEADER_FIELDS = [
  "vendor_id", "vendor_invoice_number", "invoice_date", "due_date", "currency", "subtotal", "total", "department_id",
  "requester_user_id", "po_id", "contract_id", "ship_to_province", "document_type",
] as const;

export type ReviewEdit = {
  header: Partial<Record<(typeof HEADER_FIELDS)[number], string | number | null>>;
  lines: { line_no: number; gl_account: string | null; department_id: string | null; line_type: "goods" | "services" }[];
};

// The clerk's edits on the invoice page; steps 3–5 run again afterwards.
export async function saveEdits(actor: User | null, parsedInvoiceId: string, edit: ReviewEdit) {
  assertCan(actor, "parsed.review");
  return tx(async (c) => {
    const p = await getParsed(actor, parsedInvoiceId, c);
    if (!p || p.status !== "pending") throw new ForbiddenError("Not pending");
    const before = p.invoice_json;
    const d: InvoiceData = structuredClone(before);
    const manual = new Set(d.manual ?? []);
    for (const f of HEADER_FIELDS) {
      if (!(f in edit.header)) continue;
      const v = edit.header[f];
      const current = (d as Record<string, unknown>)[f];
      const value = v === "" ? null : v;
      if (String(current ?? "") !== String(value ?? "")) {
        (d as Record<string, unknown>)[f] = typeof current === "number" && value != null ? Number(value) : value;
        manual.add(f);
      }
    }
    d.manual = [...manual];
    const now = new Date().toISOString();
    for (const e of edit.lines) {
      const l = d.lines.find((x) => x.line_no === e.line_no);
      if (!l) continue;
      const changed = e.gl_account !== l.suggested_gl_account || e.department_id !== l.suggested_department_id;
      l.gl_account = e.gl_account;
      l.department_id = e.department_id;
      l.line_type = e.line_type;
      l.coding_status = changed ? "changed" : "accepted";
      l.coded_by = actor.user_id;
      l.coded_at = now;
    }
    const raw = (await getRawItem(actor, p.raw_item_id, c))!;
    const after = await resolveAndCheck(c, parsedInvoiceId, raw, d);
    await writeAudit(c, { organizationId: p.organization_id, actor, action: "parsed_invoice.edit", entityType: "parsed_invoice", entityId: parsedInvoiceId, before, after });
  });
}

export async function resolveFlag(actor: User | null, flagId: string, status: "resolved" | "overridden", note: string) {
  assertCan(actor, "parsed.review");
  await tx(async (c) => {
    const f = await one<{ parsed_invoice_id: string; status: string }>("SELECT parsed_invoice_id, status FROM invoice_flags WHERE flag_id=$1", [flagId], c);
    if (!f) throw new ForbiddenError("No such flag");
    const p = await getParsed(actor, f.parsed_invoice_id, c);
    if (!p || p.status !== "pending") throw new ForbiddenError("Not pending");
    if (!note.trim()) throw new ForbiddenError("A note is required");
    await query("UPDATE invoice_flags SET status=$2, resolved_by=$3, resolved_at=now(), resolution_note=$4 WHERE flag_id=$1", [flagId, status, actor.user_id, note], c);
    await writeAudit(c, { organizationId: p.organization_id, actor, action: `flag.${status}`, entityType: "invoice_flag", entityId: flagId, note });
  });
}

export async function reject(actor: User | null, parsedInvoiceId: string, reason: string) {
  assertCan(actor, "parsed.review");
  await tx(async (c) => {
    const p = await getParsed(actor, parsedInvoiceId, c);
    if (!p || p.status !== "pending") throw new ForbiddenError("Not pending");
    await query("UPDATE parsed_invoices SET status='rejected', reviewed_by=$2, reviewed_at=now(), rejection_reason=$3 WHERE parsed_invoice_id=$1", [parsedInvoiceId, actor.user_id, reason], c);
    await writeAudit(c, { organizationId: p.organization_id, actor, action: "parsed_invoice.reject", entityType: "parsed_invoice", entityId: parsedInvoiceId, note: reason });
  });
}

// What an import carries for a past invoice: its id, final status, and the approvals and payments it already had.
export type HistoryRecord = {
  invoice_id: string;
  status: "pending_approval" | "approved" | "scheduled" | "paid" | "rejected";
  approvals: { approval_id: string; step_no: number; approver_user_id: string; action: "approved" | "rejected"; acted_at: string; comment: string | null }[];
  payments: {
    payment_id: string; method: "EFT" | "CHEQUE" | "CARD"; scheduled_date: string | null; paid_date: string | null; currency: string; amount: number;
    fx_rate_to_cad: number; amount_cad: number; discount_taken: number; reference: string; status: "scheduled" | "outstanding" | "settled";
    prepared_by: string | null; released_by: string | null;
  }[];
};

// Approve: the parsed invoice becomes an invoice and its approval chain starts.
export async function approve(actor: User | null, parsedInvoiceId: string, history?: HistoryRecord) {
  if (history) assertCan(actor, "org.manage");
  else assertCan(actor, "parsed.review");
  return tx(async (c) => {
    const p = await getParsed(actor, parsedInvoiceId, c);
    if (!p || p.status !== "pending") throw new ForbiddenError("Not pending");
    const open = await query<{ message: string }>("SELECT message FROM invoice_flags WHERE parsed_invoice_id=$1 AND severity='blocking' AND status='open'", [parsedInvoiceId], c);
    if (open.length && !history) throw new ForbiddenError(`Resolve the blocking flags first: ${open.map((f) => f.message).join(" | ")}`);
    const d = p.invoice_json;
    if (!d.vendor_id && !history) throw new ForbiddenError("Pick a vendor first");

    const id = history?.invoice_id ?? (await nextId("INV", c));
    const dup = await one<{ related_invoice_id: string }>(
      "SELECT related_invoice_id FROM invoice_flags WHERE parsed_invoice_id=$1 AND category='duplicate' AND related_invoice_id IS NOT NULL LIMIT 1",
      [parsedInvoiceId],
      c,
    );
    const creditFor = d.document_type === "credit_note" && d.credit_note_reference
      ? await one<{ invoice_id: string }>("SELECT invoice_id FROM invoices WHERE organization_id=$1 AND vendor_id=$2 AND vendor_invoice_number=$3", [p.organization_id, d.vendor_id, d.credit_note_reference], c)
      : null;
    await query(
      `INSERT INTO invoices (invoice_id, organization_id, parsed_invoice_id, is_historical, type, status, vendor_id, vendor_invoice_number, number_normalized,
         invoice_date, received_date, due_date, currency, subtotal, gst_hst_amount, pst_qst_amount, total, fx_rate_to_cad, total_cad, department_id,
         requester_user_id, po_id, contract_id, bill_to_name, bill_to_tax_number, bill_to_address, ship_to_province, remit_institution, remit_transit,
         remit_account, lines, duplicate_of_invoice_id, credit_for_invoice_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
      [
        id, p.organization_id, parsedInvoiceId, !!history, d.document_type, history?.status ?? "pending_approval", d.vendor_id, d.vendor_invoice_number,
        invoiceNumberCore(d.vendor_invoice_number), d.invoice_date, d.received_date ?? null, d.due_date, d.currency, d.subtotal, d.gst_hst_amount ?? 0,
        d.pst_qst_amount ?? 0, d.total, d.fx_rate_to_cad ?? 1, d.total_cad, d.department_id, d.requester_user_id, d.po_id, d.contract_id, d.bill_to_name,
        d.bill_to_tax_number, d.bill_to_address, d.ship_to_province, d.remit_institution, d.remit_transit, d.remit_account, JSON.stringify(d.lines),
        dup?.related_invoice_id ?? null, creditFor?.invoice_id ?? null, actor.user_id,
      ],
      c,
    );
    await query("UPDATE parsed_invoices SET status='approved', reviewed_by=$2, reviewed_at=now(), invoice_id=$3 WHERE parsed_invoice_id=$1", [parsedInvoiceId, actor.user_id, id], c);
    await writeAudit(c, { organizationId: p.organization_id, actor, action: history ? "invoice.import" : "invoice.create", entityType: "invoice", entityId: id, invoiceId: id, vendorId: d.vendor_id, after: d });

    if (history) await recordHistory(c, p.organization_id, id, d.vendor_id!, history);
    else await startApprovalChain(c, actor, id);
    return id;
  });
}

async function recordHistory(c: PoolClientLike, orgId: string, invoiceId: string, vendorId: string, h: HistoryRecord) {
  for (const a of h.approvals) {
    await query(
      `INSERT INTO approvals (approval_id, invoice_id, step_no, assigned_user_id, original_user_id, status, acted_by, comment, acted_at)
       VALUES ($1,$2,$3,$4,$4,$5,$4,$6,$7)`,
      [a.approval_id, invoiceId, a.step_no, a.approver_user_id, a.action, a.comment, a.acted_at],
      c,
    );
  }
  for (const pay of h.payments) {
    const ref = pay.reference;
    await query(
      `INSERT INTO payments (payment_id, organization_id, invoice_id, vendor_id, method, scheduled_date, paid_date, currency, amount, fx_rate_to_cad, amount_cad,
         discount_taken, status, prepared_by, released_by, bank_reference, card_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [pay.payment_id, orgId, invoiceId, vendorId, pay.method, pay.scheduled_date, pay.paid_date, pay.currency, pay.amount, pay.fx_rate_to_cad, pay.amount_cad,
        pay.discount_taken, pay.status, pay.prepared_by, pay.released_by, pay.method === "CARD" ? null : ref, pay.method === "CARD" ? ref : null],
      c,
    );
  }
}
