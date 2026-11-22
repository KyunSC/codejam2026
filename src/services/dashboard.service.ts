import { query, one } from "@/lib/db";
import { assertMember, can } from "@/lib/authz";
import { today } from "@/lib/dates";
import { type CardId, type TileId, DASHBOARD_CARDS, DASHBOARD_TILES, allowedOn } from "@/lib/preferences";
import type { User } from "@/lib/types";

// Data for the dashboard's added widgets, asked for by id: only the widgets on the user's dashboard are computed, and each
// only when the user's role may see it (the same permission that offers it in the palette). Amounts are in CAD.
// Spend counts invoices that are approved, scheduled or paid, across the organization or, for someone who only sees their
// department, in that department.

export type BarRow = { label: string; value: number; href?: string };
export type DueRow = { invoice_id: string; vendor: string | null; due_date: string; total: number; currency: string; status: string };
export type WidgetData = Partial<Record<TileId | CardId, number | BarRow[] | DueRow[]>>;

const SPEND = "i.status IN ('approved','scheduled','paid')";
const UNPAID = "i.status IN ('pending_approval','approved','scheduled')";

export async function dashboardWidgets(user: User | null, organizationId: string, ids: string[]): Promise<WidgetData> {
  assertMember(user, organizationId);
  const defs = [...DASHBOARD_TILES, ...DASHBOARD_CARDS];
  const wanted = new Set(ids.filter((id) => defs.some((d) => d.id === id && allowedOn(d, user))));
  const asOf = today();
  // the invoices the user may count: all of them, or their department's
  const dept = can(user, "invoice.view_all") ? null : user.department_id;
  const base = [organizationId, dept];
  const scope = "i.organization_id=$1 AND ($2::text IS NULL OR i.department_id=$2)";
  const out: WidgetData = {};

  if (wanted.has("overdue")) {
    out.overdue = (await one<{ n: number }>(`SELECT count(*)::int n FROM invoices i WHERE ${scope} AND ${UNPAID} AND i.due_date < $3::date`, [...base, asOf]))!.n;
  }
  if (wanted.has("due_week")) {
    out.due_week = (await one<{ n: number }>(
      `SELECT count(*)::int n FROM invoices i WHERE ${scope} AND ${UNPAID} AND i.due_date BETWEEN $3::date AND $3::date + 7`, [...base, asOf],
    ))!.n;
  }
  if (wanted.has("paid_month")) {
    out.paid_month = (await one<{ n: number }>(
      "SELECT COALESCE(sum(amount_cad),0)::float n FROM payments WHERE organization_id=$1 AND status='settled' AND paid_date >= date_trunc('month', $2::date)",
      [organizationId, asOf],
    ))!.n;
  }
  if (wanted.has("outstanding_cheques")) {
    out.outstanding_cheques = (await one<{ n: number }>("SELECT count(*)::int n FROM payments WHERE organization_id=$1 AND status='outstanding'", [organizationId]))!.n;
  }
  if (wanted.has("open_pos")) {
    out.open_pos = (await one<{ n: number }>(
      "SELECT count(*)::int n FROM purchase_orders o JOIN vendors v USING (vendor_id) WHERE v.organization_id=$1 AND o.status <> 'closed'", [organizationId],
    ))!.n;
  }
  if (wanted.has("contracts_ending")) {
    out.contracts_ending = (await one<{ n: number }>(
      "SELECT count(*)::int n FROM contracts c JOIN vendors v USING (vendor_id) WHERE v.organization_id=$1 AND c.status='active' AND c.end_date BETWEEN $2::date AND $2::date + 60",
      [organizationId, asOf],
    ))!.n;
  }

  if (wanted.has("monthly_spend")) {
    out.monthly_spend = await query<BarRow>(
      `SELECT to_char(m, 'YYYY-MM') AS label, COALESCE(sum(i.total_cad), 0)::float AS value
         FROM generate_series(date_trunc('month', $3::date) - interval '11 months', date_trunc('month', $3::date), interval '1 month') m
         LEFT JOIN invoices i ON ${scope} AND ${SPEND} AND date_trunc('month', i.invoice_date) = m
        GROUP BY m ORDER BY m`,
      [...base, asOf],
    );
  }
  if (wanted.has("vendor_spend")) {
    out.vendor_spend = await query<BarRow>(
      `SELECT v.legal_name AS label, sum(i.total_cad)::float AS value, '/vendors/' || v.vendor_id AS href
         FROM invoices i JOIN vendors v USING (vendor_id)
        WHERE ${scope} AND ${SPEND} AND i.invoice_date >= date_trunc('month', $3::date) - interval '2 months'
        GROUP BY v.vendor_id, v.legal_name ORDER BY value DESC LIMIT 8`,
      [...base, asOf],
    );
  }
  if (wanted.has("account_spend")) {
    out.account_spend = await query<BarRow>(
      `SELECT COALESCE(g.account_number || ' ' || g.name, 'Not coded') AS label, sum((l->>'amount')::numeric * i.fx_rate_to_cad)::float AS value
         FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l
         LEFT JOIN gl_accounts g ON g.organization_id = i.organization_id AND g.account_number = l->>'gl_account'
        WHERE ${scope} AND ${SPEND} AND i.invoice_date >= date_trunc('month', $3::date) - interval '2 months'
        GROUP BY 1 ORDER BY value DESC LIMIT 8`,
      [...base, asOf],
    );
  }
  if (wanted.has("invoice_status")) {
    out.invoice_status = await query<BarRow>(
      `SELECT replace(i.status, '_', ' ') AS label, count(*)::int AS value, '/invoices?status=' || i.status AS href
         FROM invoices i WHERE ${scope} AND i.status <> 'void' GROUP BY i.status
        ORDER BY array_position(ARRAY['pending_approval','approved','scheduled','paid','rejected'], i.status)`,
      base,
    );
  }
  if (wanted.has("payment_methods")) {
    out.payment_methods = await query<BarRow>(
      `SELECT method AS label, sum(amount_cad)::float AS value FROM payments
        WHERE organization_id=$1 AND status IN ('released','outstanding','settled') AND COALESCE(paid_date, scheduled_date) >= date_trunc('month', $2::date) - interval '2 months'
        GROUP BY method ORDER BY value DESC`,
      [organizationId, asOf],
    );
  }
  if (wanted.has("upcoming_due")) {
    out.upcoming_due = await query<DueRow>(
      `SELECT i.invoice_id, v.legal_name AS vendor, i.due_date::text, i.total::float, i.currency, i.status
         FROM invoices i LEFT JOIN vendors v USING (vendor_id)
        WHERE ${scope} AND ${UNPAID} AND i.due_date BETWEEN $3::date AND $3::date + 14
        ORDER BY i.due_date, i.invoice_id LIMIT 20`,
      [...base, asOf],
    );
  }
  return out;
}
