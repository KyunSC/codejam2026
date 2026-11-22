import { Db, query } from "./db";
import type { User } from "./types";

export type AuditInput = {
  organizationId: string | null;
  actor: User | null;
  onBehalfOf?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  vendorId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
};

// Called inside the same transaction as the change it records.
export async function writeAudit(db: Db, a: AuditInput) {
  await query(
    `INSERT INTO audit_events (organization_id, actor_user_id, actor_role, on_behalf_of_user_id, action,
       entity_type, entity_id, invoice_id, payment_id, vendor_id, before_json, after_json, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      a.organizationId,
      a.actor?.user_id ?? null,
      a.actor?.role ?? null,
      a.onBehalfOf ?? null,
      a.action,
      a.entityType,
      a.entityId,
      a.invoiceId ?? null,
      a.paymentId ?? null,
      a.vendorId ?? null,
      a.before === undefined ? null : JSON.stringify(a.before),
      a.after === undefined ? null : JSON.stringify(a.after),
      a.note ?? null,
    ],
    db,
  );
}
