import { query, one } from "@/lib/db";
import { assertMember, authorize, can, invoiceScope } from "@/lib/authz";
import { NotFoundError } from "@/lib/errors";
import { window, type Paging } from "@/lib/paging";
import type { InvoiceData, InvoiceLine, User } from "@/lib/types";
import { canActOn, pendingForUserSql } from "./approval.service";
import { getParsed } from "./pipeline.service";
import { getRawItem, type RawItem } from "./rawIntake.service";
import { releaseBlocks } from "./payment.service";

// Read side shared by the API and the pages: each list and record has one function, limited to what the user may see.

// --- raw items ---

export type RawItemRow = {
  total_count: number; raw_item_id: string; kind: string; received_at: string; from_name: string | null; from_address: string | null; subject: string | null;
  files: { file_name: string }[]; form_json: InvoiceData | null; submitted_by: string | null; submitter: string | null; status: string; no_invoice_reason: string | null;
  failure_reason: string | null;
};

// Raw items not yet extracted come first. Those who do not see all invoices see only what they submitted.
export async function listRawItems(user: User | null, organizationId: string, f: Paging & { kind?: string | null; status?: string | null } = {}) {
  assertMember(user, organizationId);
  const { limit, offset } = window(f);
  return query<RawItemRow>(
    `SELECT r.raw_item_id, r.kind, r.received_at, r.from_name, r.from_address, r.subject, r.files, r.form_json, r.submitted_by, u.full_name AS submitter,
            r.status, r.no_invoice_reason, r.failure_reason, count(*) OVER ()::int AS total_count
       FROM raw_items r LEFT JOIN users u ON u.user_id=r.submitted_by
      WHERE r.organization_id=$1 AND ($2::text IS NULL OR r.kind=$2) AND ($3::text IS NULL OR r.status=$3) AND ($4::text IS NULL OR r.submitted_by=$4)
        AND NOT EXISTS (SELECT 1 FROM parsed_invoices p JOIN invoices i ON i.parsed_invoice_id=p.parsed_invoice_id WHERE p.raw_item_id=r.raw_item_id AND i.is_historical)
      ORDER BY (r.status='new') DESC, r.received_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [organizationId, f.kind || null, f.status || null, can(user, "invoice.view_all") ? null : user.user_id],
  );
}

// A raw item, for those who see all invoices, its submitter, and anyone who may see the invoice made from it.
export async function getRawItemRecord(user: User | null, organizationId: string, id: string): Promise<RawItem> {
  assertMember(user, organizationId);
  const r = await getRawItem(user, organizationId, id);
  if (!r || !(can(user, "invoice.view_all") || r.submitted_by === user.user_id || (await seesInvoiceFrom(user, id)))) throw new NotFoundError("No such raw item");
  return r;
}

async function seesInvoiceFrom(user: User, rawItemId: string) {
  const s = invoiceScope(user);
  const row = await one(
    `SELECT 1 FROM invoices i JOIN parsed_invoices p ON p.parsed_invoice_id=i.parsed_invoice_id WHERE ${s.sql} AND p.raw_item_id=$${s.params.length + 1}`,
    [...s.params, rawItemId],
  );
  return !!row;
}

// --- parsed invoices ---

export type ParsedRow = {
  total_count: number; parsed_invoice_id: string; raw_item_id: string; file_name: string | null; status: string; invoice_id: string | null;
  invoice_json: InvoiceData; vendor_name: string | null; blocking: number; warnings: number;
};

export async function listParsedInvoices(user: User | null, organizationId: string, f: Paging & { status?: string | null } = {}) {
  assertMember(user, organizationId);
  const { limit, offset } = window(f);
  return query<ParsedRow>(
    `SELECT p.parsed_invoice_id, p.raw_item_id, p.file_name, p.status, p.invoice_id, p.invoice_json, v.legal_name AS vendor_name,
            (SELECT count(*)::int FROM invoice_flags f WHERE f.parsed_invoice_id=p.parsed_invoice_id AND f.status='open' AND f.severity='blocking') AS blocking,
            (SELECT count(*)::int FROM invoice_flags f WHERE f.parsed_invoice_id=p.parsed_invoice_id AND f.status='open' AND f.severity='warning') AS warnings,
            count(*) OVER ()::int AS total_count
       FROM parsed_invoices p LEFT JOIN vendors v ON v.vendor_id = p.invoice_json->>'vendor_id'
      WHERE p.organization_id=$1 AND p.status=COALESCE($2, 'pending')
        AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM raw_items r WHERE r.raw_item_id=p.raw_item_id AND r.submitted_by=$3))
      ORDER BY p.parsed_invoice_id LIMIT ${limit} OFFSET ${offset}`,
    [organizationId, f.status || null, can(user, "invoice.view_all") ? null : user.user_id],
  );
}

export type FlagRow = {
  flag_id: string; line_no: number | null; check_code: string; category: string; severity: string; message: string; status: string;
  resolution_note: string | null; resolver: string | null; related_invoice_id: string | null;
};

// A parsed invoice's flags, blocking first.
const flagsOf = (parsedInvoiceId: string) =>
  query<FlagRow>(
    `SELECT f.*, u.full_name AS resolver FROM invoice_flags f LEFT JOIN users u ON u.user_id=f.resolved_by WHERE f.parsed_invoice_id=$1
      ORDER BY CASE f.severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.category`,
    [parsedInvoiceId],
  );

// A parsed invoice with its flags, for whoever may see its raw item.
export async function getParsedInvoiceRecord(user: User | null, organizationId: string, id: string) {
  assertMember(user, organizationId);
  const p = await getParsed(user, organizationId, id);
  if (!p) throw new NotFoundError("No such parsed invoice");
  await getRawItemRecord(user, organizationId, p.raw_item_id);
  return { ...p, flags: await flagsOf(id) };
}

// --- invoices ---

export type InvoiceRow = {
  total_count: number; invoice_id: string; vendor_id: string; vendor_name: string | null; vendor_invoice_number: string; invoice_date: string; due_date: string | null;
  currency: string; total: number; total_cad: number; department_id: string | null; department: string | null; requester_user_id: string | null;
  status: string; type: string; is_historical: boolean; waiting_on: string | null; mine: boolean;
};

// Invoices the user may see; those waiting on the user's approval come first.
export async function listInvoices(user: User | null, organizationId: string, f: Paging & { status?: string | null; vendor_id?: string | null; type?: string | null } = {}) {
  assertMember(user, organizationId);
  const { limit, offset } = window(f);
  const s = invoiceScope(user);
  const n = s.params.length;
  return query<InvoiceRow>(
    `SELECT i.invoice_id, i.vendor_id, v.legal_name AS vendor_name, i.vendor_invoice_number, i.invoice_date, i.due_date, i.currency, i.total, i.total_cad,
            i.department_id, d.name AS department, i.requester_user_id, i.status, i.type, i.is_historical, count(*) OVER ()::int AS total_count,
            (SELECT u.full_name FROM approvals a JOIN users u ON u.user_id=a.assigned_user_id WHERE a.invoice_id=i.invoice_id AND a.status='pending' LIMIT 1) AS waiting_on,
            EXISTS (SELECT 1 FROM approvals a LEFT JOIN users au ON au.user_id=a.assigned_user_id WHERE a.invoice_id=i.invoice_id AND ${pendingForUserSql(`$${n + 1}`)}) AS mine
       FROM invoices i LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN departments d ON d.department_id=i.department_id
      WHERE ${s.sql} AND ($${n + 2}::text IS NULL OR i.status=$${n + 2}) AND ($${n + 3}::text IS NULL OR i.vendor_id=$${n + 3})
        AND ($${n + 4}::text IS NULL OR i.type=$${n + 4})
      ORDER BY mine DESC, i.invoice_date DESC, i.invoice_id DESC LIMIT ${limit} OFFSET ${offset}`,
    [...s.params, user.user_id, f.status || null, f.vendor_id || null, f.type || null],
  );
}

export type InvoiceRecord = {
  invoice_id: string; parsed_invoice_id: string | null; is_historical: boolean; type: string; status: string; vendor_id: string; vendor_name: string;
  vendor_invoice_number: string; invoice_date: string; due_date: string | null; currency: string; subtotal: number; gst_hst_amount: number; pst_qst_amount: number;
  total: number; fx_rate_to_cad: number; total_cad: number; department_id: string | null; department: string | null; requester: string | null; requester_user_id: string | null;
  po_id: string | null; contract_id: string | null; ship_to_province: string | null; lines: InvoiceLine[]; duplicate_of_invoice_id: string | null; credit_for_invoice_id: string | null;
};
export type ApprovalStep = {
  approval_id: string; invoice_id: string; step_no: number; rule_id: string | null; assigned_user_id: string | null; original_user_id: string | null;
  reassign_reason: string | null; status: string; acted_at: string | null; comment: string | null; assignee: string | null; original: string | null; actor: string | null; on_behalf: string | null;
  // whether the signed-in user may approve or reject this step now
  can_act: boolean;
};
export type PaymentRow = {
  total_count: number; payment_id: string; invoice_id: string; vendor_id: string; vendor: string; method: string; amount: number; currency: string; amount_cad: number;
  fx_rate_to_cad: number; scheduled_date: string | null; paid_date: string | null; status: string; preparer: string | null; releaser: string | null; released_at: string | null;
  snapshot_institution: string | null; snapshot_transit: string | null; snapshot_account: string | null; bank_reference: string | null; card_reference: string | null; discount_taken: number;
  // for a scheduled payment: whether the signed-in user may release it, and if not, why
  can_release?: boolean; release_blocked?: string | null;
};

// Adds can_release / release_blocked for the signed-in user.
async function withRelease(user: User, organizationId: string, rows: PaymentRow[]) {
  if (!can(user, "payment.release")) return rows;
  const blocks = await releaseBlocks(user, organizationId, rows);
  return rows.map((r) => (r.status === "scheduled" ? { ...r, can_release: !blocks.get(r.payment_id), release_blocked: blocks.get(r.payment_id) ?? null } : r));
}

const PAYMENT_SELECT = `SELECT p.*, v.legal_name vendor, u1.full_name preparer, u2.full_name releaser, count(*) OVER ()::int AS total_count
  FROM payments p JOIN vendors v USING (vendor_id) LEFT JOIN users u1 ON u1.user_id=p.prepared_by LEFT JOIN users u2 ON u2.user_id=p.released_by`;

// An invoice the user may see, with its approval chain and, for those who see payments, its payments.
export async function getInvoiceRecord(user: User | null, organizationId: string, id: string) {
  assertMember(user, organizationId);
  const s = invoiceScope(user);
  const invoice = await one<InvoiceRecord>(
    `SELECT i.*, v.legal_name AS vendor_name, d.name AS department, u.full_name AS requester FROM invoices i
       LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN departments d ON d.department_id=i.department_id LEFT JOIN users u ON u.user_id=i.requester_user_id
     WHERE ${s.sql} AND i.invoice_id=$${s.params.length + 1}`,
    [...s.params, id],
  );
  if (!invoice) throw new NotFoundError("No such invoice");
  const steps = await query<Omit<ApprovalStep, "can_act">>(
    `SELECT a.*, u1.full_name AS assignee, u2.full_name AS original, u3.full_name AS actor, u4.full_name AS on_behalf FROM approvals a
       LEFT JOIN users u1 ON u1.user_id=a.assigned_user_id LEFT JOIN users u2 ON u2.user_id=a.original_user_id
       LEFT JOIN users u3 ON u3.user_id=a.acted_by LEFT JOIN users u4 ON u4.user_id=a.on_behalf_of_user_id
     WHERE a.invoice_id=$1 ORDER BY a.step_no`,
    [id],
  );
  const mayAct = invoice.requester_user_id !== user.user_id && can(user, "approval.act");
  const approvals: ApprovalStep[] = [];
  for (const st of steps) approvals.push({ ...st, can_act: mayAct && (await canActOn(user, st)).ok });
  const payments = can(user, "payment.view") ? await query<PaymentRow>(`${PAYMENT_SELECT} WHERE p.invoice_id=$1 ORDER BY p.payment_id`, [id]) : [];
  return { ...invoice, approvals, payments };
}

// --- payments ---

export async function listPayments(user: User | null, organizationId: string, f: Paging & { status?: string | null } = {}) {
  authorize(user, organizationId, "payment.view");
  const { limit, offset } = window(f);
  // payments still to go out: the earliest due first; the rest: the latest first
  const upcoming = f.status === "scheduled" || f.status === "released";
  const rows = await query<PaymentRow>(
    `${PAYMENT_SELECT} WHERE p.organization_id=$1 AND ($2::text IS NULL OR p.status=$2)
      ORDER BY p.scheduled_date ${upcoming ? "ASC" : "DESC"} NULLS LAST, p.payment_id DESC LIMIT ${limit} OFFSET ${offset}`,
    [organizationId, f.status || null],
  );
  return withRelease(user, organizationId, rows);
}

// Count and CAD total of the payments in each status.
export async function paymentTotals(user: User | null, organizationId: string) {
  authorize(user, organizationId, "payment.view");
  return query<{ status: string; n: number; total: number }>(
    "SELECT status, count(*)::int n, sum(amount_cad)::float total FROM payments WHERE organization_id=$1 GROUP BY status",
    [organizationId],
  );
}

export async function getPaymentRecord(user: User | null, organizationId: string, id: string) {
  authorize(user, organizationId, "payment.view");
  const p = await one<PaymentRow>(`${PAYMENT_SELECT} WHERE p.payment_id=$1 AND p.organization_id=$2`, [id, organizationId]);
  if (!p) throw new NotFoundError("No such payment");
  return (await withRelease(user, organizationId, [p]))[0];
}

// --- approvals waiting on the user ---

export type WaitingApproval = {
  approval_id: string; step_no: number; invoice_id: string; vendor_name: string | null; vendor_invoice_number: string; invoice_date: string;
  total: number; currency: string; on_behalf_of: string | null;
};

// Steps waiting on the signed-in user (or on someone on leave they cover), leaving out invoices they requested.
export async function listWaitingApprovals(user: User | null, organizationId: string) {
  assertMember(user, organizationId);
  return query<WaitingApproval>(
    `SELECT a.approval_id, a.step_no, i.invoice_id, v.legal_name AS vendor_name, i.vendor_invoice_number, i.invoice_date, i.total, i.currency,
            CASE WHEN a.assigned_user_id <> $1 THEN au.full_name END AS on_behalf_of
       FROM approvals a JOIN invoices i USING (invoice_id) LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN users au ON au.user_id=a.assigned_user_id
      WHERE i.organization_id=$2 AND ${pendingForUserSql("$1")} AND i.requester_user_id IS DISTINCT FROM $1
      ORDER BY i.invoice_date`,
    [user.user_id, organizationId],
  );
}

// --- spend ---

// Approved invoice spend in CAD by department and month, for the last three months.
// Those who see all invoices get every department; department approvers get their own.
export async function departmentSpend(user: User | null, organizationId: string) {
  assertMember(user, organizationId);
  if (!can(user, "invoice.view_all") && !can(user, "invoice.view_department")) return [];
  return query<{ department: string; month: string; total: number }>(
    `SELECT d.name department, to_char(i.invoice_date,'YYYY-MM') AS month, sum(i.total_cad)::float AS total FROM invoices i JOIN departments d USING (department_id)
      WHERE i.organization_id=$1 AND i.status IN ('approved','scheduled','paid') AND ($2::text IS NULL OR i.department_id=$2)
        AND i.invoice_date >= date_trunc('month', current_date) - interval '2 months'
      GROUP BY 1,2 ORDER BY 1,2`,
    [organizationId, can(user, "invoice.view_all") ? null : user.department_id],
  );
}
