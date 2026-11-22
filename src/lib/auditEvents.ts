import { query } from "./db";

export type AuditRow = {
  event_id: string; occurred_at: string; actor: string | null; actor_role: string | null; on_behalf: string | null; action: string;
  entity_type: string; entity_id: string; invoice_id: string | null; payment_id: string | null; vendor_id: string | null; note: string | null;
};

export const AUDIT_BATCH = 20;

// One batch of the organization's audit log, newest first, older than `before` when given.
export function auditBatch(organizationId: string, q: string, before: number | null) {
  return query<AuditRow>(
    `SELECT e.event_id::text, e.occurred_at, u.full_name actor, e.actor_role, ob.full_name on_behalf, e.action, e.entity_type, e.entity_id,
            e.invoice_id, e.payment_id, e.vendor_id, e.note
       FROM audit_events e LEFT JOIN users u ON u.user_id=e.actor_user_id LEFT JOIN users ob ON ob.user_id=e.on_behalf_of_user_id
      WHERE e.organization_id=$1 AND ($3::bigint IS NULL OR e.event_id < $3)
        AND ($2='' OR e.action ILIKE '%'||$2||'%' OR e.entity_id ILIKE '%'||$2||'%' OR e.invoice_id ILIKE '%'||$2||'%' OR u.full_name ILIKE '%'||$2||'%')
      ORDER BY e.event_id DESC LIMIT ${AUDIT_BATCH}`,
    [organizationId, q, before],
  );
}
