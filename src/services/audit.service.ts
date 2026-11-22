import { query } from "@/lib/db";
import { authorize } from "@/lib/authz";
import { API_PAGE_SIZE, window, type Paging } from "@/lib/paging";
import { getInvoiceRecord, getParsedInvoiceRecord } from "./read.service";
import type { User } from "@/lib/types";

export type AuditRow = {
  event_id: string; occurred_at: string; actor: string | null; actor_role: string | null; on_behalf: string | null; action: string;
  entity_type: string; entity_id: string; invoice_id: string | null; payment_id: string | null; vendor_id: string | null; note: string | null; channel: string;
};

export type AuditFilter = { invoice: string; actor: string; action: string };

const FILTER_SQL = "($2='' OR e.invoice_id=$2) AND ($3='' OR e.actor_user_id=$3) AND ($4='' OR e.action=$4)";

export function filterFrom(sp: { get(k: string): string | null } | Record<string, string | string[] | undefined>): AuditFilter {
  const get = (k: string) => {
    const v = "get" in sp && typeof sp.get === "function" ? (sp as { get(k: string): string | null }).get(k) : (sp as Record<string, unknown>)[k];
    return typeof v === "string" ? v : "";
  };
  return { invoice: get("invoice"), actor: get("actor"), action: get("action") };
}

// One page of the organization's audit log, newest first, with the total for the pager.
export function auditPage(user: User | null, organizationId: string, f: AuditFilter, p: Paging = {}) {
  authorize(user, organizationId, "audit.view");
  const { limit, offset } = window(p);
  return query<AuditRow & { total_count: number }>(
    `SELECT e.event_id::text, e.occurred_at, u.full_name actor, e.actor_role, ob.full_name on_behalf, e.action, e.entity_type, e.entity_id,
            e.invoice_id, e.payment_id, e.vendor_id, e.note, e.channel, count(*) OVER ()::int AS total_count
       FROM audit_events e LEFT JOIN users u ON u.user_id=e.actor_user_id LEFT JOIN users ob ON ob.user_id=e.on_behalf_of_user_id
      WHERE e.organization_id=$1 AND ${FILTER_SQL}
      ORDER BY e.event_id DESC LIMIT ${limit} OFFSET ${offset}`,
    [organizationId, f.invoice, f.actor, f.action],
  );
}

// One page of invoice IDs for the invoice filter, by most recent audit activity.
export async function auditInvoicePage(user: User | null, organizationId: string, offset: number) {
  authorize(user, organizationId, "audit.view");
  const rows = await query<{ invoice_id: string }>(
    `SELECT invoice_id FROM audit_events WHERE organization_id=$1 AND invoice_id IS NOT NULL
      GROUP BY invoice_id ORDER BY max(event_id) DESC LIMIT ${API_PAGE_SIZE} OFFSET $2`,
    [organizationId, Math.max(0, offset)],
  );
  return rows.map((r) => r.invoice_id);
}

// Choices for the three filters: invoices by most recent activity, people who acted, actions taken.
export async function auditFilterOptions(user: User | null, organizationId: string) {
  authorize(user, organizationId, "audit.view");
  const [invoices, people, actions] = await Promise.all([
    auditInvoicePage(user, organizationId, 0),
    query<{ user_id: string; full_name: string }>(
      "SELECT u.user_id, u.full_name FROM users u WHERE EXISTS (SELECT 1 FROM audit_events e WHERE e.actor_user_id=u.user_id AND e.organization_id=$1) ORDER BY u.full_name",
      [organizationId],
    ),
    query<{ action: string }>("SELECT DISTINCT action FROM audit_events WHERE organization_id=$1 ORDER BY action", [organizationId]),
  ]);
  return { invoices, people, actions: actions.map((r) => r.action) };
}

export type TrailEvent = { event_id: string; occurred_at: string; action: string; entity_id: string; actor: string | null; actor_role: string | null; on_behalf: string | null; note: string | null; channel: string };

// Everything that happened to an invoice: its raw item and parsed invoice, then the invoice itself. For whoever may see the invoice.
export async function invoiceTrail(user: User | null, organizationId: string, invoiceId: string) {
  const inv = await getInvoiceRecord(user, organizationId, invoiceId);
  const parsed = inv.parsed_invoice_id ? await getParsedInvoiceRecord(user, organizationId, inv.parsed_invoice_id) : null;
  return trail(organizationId, invoiceId, parsed ? [parsed.parsed_invoice_id, parsed.raw_item_id] : []);
}

// What happened to a parsed invoice and its raw item, and to the invoice once approved. For whoever may see the parsed invoice.
export async function parsedInvoiceTrail(user: User | null, organizationId: string, parsedInvoiceId: string) {
  const p = await getParsedInvoiceRecord(user, organizationId, parsedInvoiceId);
  return trail(organizationId, p.invoice_id, [p.parsed_invoice_id, p.raw_item_id]);
}

function trail(organizationId: string, invoiceId: string | null, entityIds: string[]) {
  return query<TrailEvent>(
    `SELECT e.event_id::text, e.occurred_at, e.action, e.entity_id, u.full_name AS actor, e.actor_role, ob.full_name AS on_behalf, e.note, e.channel FROM audit_events e
       LEFT JOIN users u ON u.user_id=e.actor_user_id LEFT JOIN users ob ON ob.user_id=e.on_behalf_of_user_id
     WHERE e.organization_id=$1 AND (e.entity_id = ANY($2) OR e.invoice_id = $3) ORDER BY e.occurred_at, e.event_id`,
    [organizationId, entityIds, invoiceId ?? ""],
  );
}

const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The filtered audit log as CSV.
export async function auditCsv(user: User | null, organizationId: string, f: AuditFilter) {
  authorize(user, organizationId, "audit.view");
  const rows = await query<Record<string, unknown>>(
    `SELECT e.event_id, e.occurred_at, e.actor_user_id, u.full_name actor, e.actor_role, e.on_behalf_of_user_id, e.action, e.entity_type, e.entity_id,
            e.invoice_id, e.payment_id, e.vendor_id, e.note, e.channel, e.before_json, e.after_json
       FROM audit_events e LEFT JOIN users u ON u.user_id=e.actor_user_id
      WHERE e.organization_id=$1 AND ${FILTER_SQL}
      ORDER BY e.event_id`,
    [organizationId, f.invoice, f.actor, f.action],
  );
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
