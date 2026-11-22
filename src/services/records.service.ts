import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { query, one, tx, nextId } from "@/lib/db";
import { assertMember, authorize, type Action } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { blankToNull } from "@/lib/values";
import { policyProblem, type Policy } from "@/lib/policies";
import type { User } from "@/lib/types";
import { window } from "@/lib/paging";

// Simple organization records with plain create / read / update / delete.
type Spec = {
  table: string;
  key: string;
  idPrefix: string;
  columns: string[];
  // how a row belongs to the organization: its own column, or through its vendor
  scope: "organization" | "vendor";
  write: Action;
  // DELETE either removes the row or sets a closing value
  remove: { kind: "delete" } | { kind: "set"; column: string; value: unknown };
  // values from other tables shown alongside a row, such as the names of the people it points to
  names?: string;
  // what is wrong with a row as it would be saved, or null
  problem?: (row: Record<string, unknown>) => string | null;
  // what the search text (q) is looked for in
  search?: string[];
};

export const SPECS = {
  departments: {
    table: "departments", key: "department_id", idPrefix: "D", columns: ["name", "cost_centre", "manager_user_id"],
    scope: "organization", write: "org.settings", remove: { kind: "delete" },
    names: "(SELECT u.full_name FROM users u WHERE u.user_id = r.manager_user_id) AS manager",
  },
  gl_accounts: {
    table: "gl_accounts", key: "account_number", idPrefix: "GL", columns: ["name", "account_type"],
    scope: "organization", write: "org.settings", remove: { kind: "delete" },
  },
  contracts: {
    table: "contracts", key: "contract_id", idPrefix: "C",
    columns: ["vendor_id", "description", "monthly_fee", "currency", "hourly_rate_cap", "fuel_surcharge_cap_pct", "not_to_exceed_monthly", "start_date", "end_date", "status"],
    scope: "vendor", write: "contract.manage", remove: { kind: "set", column: "status", value: "expired" },
    names: "(SELECT v.legal_name FROM vendors v WHERE v.vendor_id = r.vendor_id) AS vendor_name",
  },
  purchase_orders: {
    table: "purchase_orders", key: "po_id", idPrefix: "PO",
    columns: ["vendor_id", "department_id", "requester_user_id", "issue_date", "description", "total_amount", "currency", "status", "approved_by"],
    scope: "vendor", write: "po.manage", remove: { kind: "set", column: "status", value: "closed" },
    search: ["r.po_id", "r.description", "(SELECT v.legal_name FROM vendors v WHERE v.vendor_id = r.vendor_id)"],
    // billed: the subtotal of the invoices against the order that are not rejected or void, as the purchase order check counts it
    names: `(SELECT v.legal_name FROM vendors v WHERE v.vendor_id = r.vendor_id) AS vendor_name,
      (SELECT d.name FROM departments d WHERE d.department_id = r.department_id) AS department,
      (SELECT u.full_name FROM users u WHERE u.user_id = r.requester_user_id) AS requester,
      (SELECT u.full_name FROM users u WHERE u.user_id = r.approved_by) AS approver,
      (SELECT COALESCE(SUM(i.subtotal), 0)::float FROM invoices i WHERE i.po_id = r.po_id AND i.status NOT IN ('rejected','void')) AS billed`,
  },
  approval_policies: {
    table: "approval_policies", key: "rule_id", idPrefix: "P", columns: ["rule_type", "field", "operator", "value", "required", "is_active"],
    scope: "organization", write: "policies.manage", remove: { kind: "set", column: "is_active", value: false },
    problem: (row) => policyProblem(row as Partial<Policy>),
    names: "(SELECT u.full_name FROM users u WHERE u.user_id = r.updated_by) AS updater",
  },
} satisfies Record<string, Spec>;

export type RecordKind = keyof typeof SPECS;

const scopeSql = (s: Spec, alias = "r") =>
  s.scope === "organization"
    ? `${alias}.organization_id = $1`
    : `EXISTS (SELECT 1 FROM vendors v WHERE v.vendor_id = ${alias}.vendor_id AND v.organization_id = $1)`;


export async function listRecords<T = Record<string, unknown>>(user: User | null, organizationId: string, kind: RecordKind, filter: Record<string, string> = {}) {
  assertMember(user, organizationId);
  const s: Spec = SPECS[kind];
  const params: unknown[] = [organizationId];
  const where = [scopeSql(s)];
  for (const [k, v] of Object.entries(filter)) {
    if (!v || !(s.columns.includes(k) || k === s.key)) continue;
    params.push(v);
    where.push(`r.${k} = $${params.length}`);
  }
  if (filter.q?.trim() && s.search) {
    params.push(filter.q.trim());
    where.push(`(${s.search.map((e) => `strpos(lower(${e}), lower($${params.length})) > 0`).join(" OR ")})`);
  }
  const paged = filter.page || filter.size;
  const { limit, offset } = window({ page: Number(filter.page) || undefined, size: Number(filter.size) || undefined });
  return query<T>(
    `SELECT r.*${s.names ? `, ${s.names}` : ""}, count(*) OVER ()::int AS total_count FROM ${s.table} r WHERE ${where.join(" AND ")} ORDER BY r.${s.key}${paged ? ` LIMIT ${limit} OFFSET ${offset}` : ""}`,
    params,
  );
}

export async function getRecord(user: User | null, organizationId: string, kind: RecordKind, id: string) {
  assertMember(user, organizationId);
  const s: Spec = SPECS[kind];
  const row = await one(`SELECT r.*${s.names ? `, ${s.names}` : ""} FROM ${s.table} r WHERE ${scopeSql(s)} AND r.${s.key} = $2`, [organizationId, id]);
  if (!row) throw new NotFoundError(`No such ${kind} ${id}`);
  return row;
}

export async function createRecord(user: User | null, organizationId: string, kind: RecordKind, body: Record<string, unknown>) {
  const s: Spec = SPECS[kind];
  authorize(user, organizationId, s.write);
  return tx(async (c) => {
    if (s.scope === "vendor") {
      const v = await one("SELECT 1 FROM vendors WHERE vendor_id=$1 AND organization_id=$2", [body.vendor_id, organizationId], c);
      if (!v) throw new NotFoundError("No such vendor in this organization");
    }
    const problem = s.problem?.(body);
    if (problem) throw new ValidationError(problem);
    const id = await nextId(s.idPrefix, c);
    const cols = [s.key, ...(s.scope === "organization" ? ["organization_id"] : []), ...s.columns.filter((col) => col in body)];
    const vals = cols.map((col) => (col === s.key ? id : col === "organization_id" ? organizationId : blankToNull(body[col])));
    await query(`INSERT INTO ${s.table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals, c);
    await writeAudit(c, { organizationId, actor: user, action: `${kind}.create`, entityType: kind, entityId: id, vendorId: (body.vendor_id as string) ?? null, after: body });
    return id;
  });
}

export async function updateRecord(user: User | null, organizationId: string, kind: RecordKind, id: string, body: Record<string, unknown>) {
  const s: Spec = SPECS[kind];
  authorize(user, organizationId, s.write);
  await tx(async (c) => {
    const before = await one(`SELECT r.* FROM ${s.table} r WHERE ${scopeSql(s)} AND r.${s.key} = $2 FOR UPDATE`, [organizationId, id], c);
    if (!before) throw new NotFoundError(`No such ${kind} ${id}`);
    const cols = s.columns.filter((col) => col in body && col !== "vendor_id");
    if (!cols.length) return;
    const problem = s.problem?.({ ...before, ...body });
    if (problem) throw new ValidationError(problem);
    await query(
      `UPDATE ${s.table} r SET ${cols.map((col, i) => `${col} = $${i + 3}`).join(", ")}${kind === "approval_policies" ? `, updated_by = $${cols.length + 3}, updated_at = now()` : ""}
        WHERE ${scopeSql(s)} AND r.${s.key} = $2`,
      [organizationId, id, ...cols.map((col) => blankToNull(body[col])), ...(kind === "approval_policies" ? [user.user_id] : [])],
      c,
    );
    await writeAudit(c, { organizationId, actor: user, action: `${kind}.update`, entityType: kind, entityId: id, before, after: body });
  });
}

export async function deleteRecord(user: User | null, organizationId: string, kind: RecordKind, id: string) {
  const s: Spec = SPECS[kind];
  authorize(user, organizationId, s.write);
  await tx(async (c) => {
    const before = await one(`SELECT r.* FROM ${s.table} r WHERE ${scopeSql(s)} AND r.${s.key} = $2 FOR UPDATE`, [organizationId, id], c);
    if (!before) throw new NotFoundError(`No such ${kind} ${id}`);
    if (s.remove.kind === "delete") {
      try {
        await query(`DELETE FROM ${s.table} r WHERE ${scopeSql(s)} AND r.${s.key} = $2`, [organizationId, id], c);
      } catch {
        throw new ConflictError(`${kind} ${id} is used by other records and cannot be deleted`);
      }
    } else {
      await query(`UPDATE ${s.table} r SET ${s.remove.column} = $3 WHERE ${scopeSql(s)} AND r.${s.key} = $2`, [organizationId, id, s.remove.value], c);
    }
    await writeAudit(c, { organizationId, actor: user, action: `${kind}.delete`, entityType: kind, entityId: id, before });
  });
}
