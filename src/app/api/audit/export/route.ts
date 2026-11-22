import { handler } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { query } from "@/lib/db";

const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The full audit log for the user's organization as CSV.
export const GET = handler(async (req, user) => {
  assertCan(user, "audit.view");
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const rows = await query<Record<string, unknown>>(
    `SELECT e.event_id, e.occurred_at, e.actor_user_id, u.full_name actor, e.actor_role, e.on_behalf_of_user_id, e.action, e.entity_type, e.entity_id,
            e.invoice_id, e.payment_id, e.vendor_id, e.note, e.before_json, e.after_json
       FROM audit_events e LEFT JOIN users u ON u.user_id=e.actor_user_id
      WHERE e.organization_id=$1 AND ($2='' OR e.action ILIKE '%'||$2||'%' OR e.entity_id ILIKE '%'||$2||'%' OR e.invoice_id ILIKE '%'||$2||'%')
      ORDER BY e.event_id`,
    [user.organization_id, q],
  );
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  return new Response(body, { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="audit.csv"' } });
});
