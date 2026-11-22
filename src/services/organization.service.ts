import { query, tx, nextId, one } from "@/lib/db";
import { assertCan, assertOrg, ForbiddenError } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

export async function createOrganization(actor: User | null, input: { organization_id?: string; legal_name: string; gst_hst_number?: string; base_currency?: string }) {
  assertCan(actor, "org.manage");
  return tx(async (c) => {
    const id = input.organization_id || (await nextId("ORG", c));
    await query(
      "INSERT INTO organizations (organization_id, legal_name, gst_hst_number, base_currency) VALUES ($1,$2,$3,$4)",
      [id, input.legal_name, input.gst_hst_number ?? null, input.base_currency ?? "CAD"],
      c,
    );
    await writeAudit(c, { organizationId: id, actor, action: "organization.create", entityType: "organization", entityId: id, after: input });
    return id;
  });
}

export async function updateOrganization(actor: User | null, id: string, input: { legal_name: string; gst_hst_number: string | null; base_currency: string }) {
  assertCan(actor, "org.manage");
  await tx(async (c) => {
    const before = await one("SELECT * FROM organizations WHERE organization_id = $1", [id], c);
    await query("UPDATE organizations SET legal_name=$2, gst_hst_number=$3, base_currency=$4 WHERE organization_id=$1", [id, input.legal_name, input.gst_hst_number, input.base_currency], c);
    await writeAudit(c, { organizationId: id, actor, action: "organization.update", entityType: "organization", entityId: id, before, after: input });
  });
}

type Row = Record<string, unknown>;

const COLUMNS: Record<string, { table: string; cols: string[]; orgColumn: boolean }> = {
  departments: { table: "departments", cols: ["department_id", "name", "cost_centre", "manager_user_id"], orgColumn: true },
  users: {
    table: "users",
    cols: ["user_id", "full_name", "email", "title", "department_id", "manager_id", "role", "approval_limit_cad", "work_province", "status", "status_since", "delegate_user_id"],
    orgColumn: true,
  },
  gl_accounts: { table: "gl_accounts", cols: ["account_number", "name", "account_type"], orgColumn: true },
  approval_policies: { table: "approval_policies", cols: ["rule_id", "rule_type", "trigger_type", "trigger_value", "step_role", "is_active"], orgColumn: true },
  vendors: {
    table: "vendors",
    cols: [
      "vendor_id", "legal_name", "category", "default_gl_account", "address", "province_or_state", "country", "gst_hst_number", "qst_number",
      "payment_terms_days", "early_pay_discount", "preferred_payment_method", "accepts_card_payment", "bank_institution", "bank_transit",
      "bank_account", "ap_contact_email", "requires_po", "status", "onboarded_at",
    ],
    orgColumn: true,
  },
  vendor_bank_changes: {
    table: "vendor_bank_changes",
    cols: ["change_id", "vendor_id", "requested_at", "requested_by", "request_channel", "new_account", "verified_by_callback", "status"],
    orgColumn: false,
  },
  contracts: {
    table: "contracts",
    cols: ["contract_id", "vendor_id", "description", "billing_type", "monthly_fee", "currency", "hourly_rate_cap", "fuel_surcharge_cap_pct", "not_to_exceed_monthly", "start_date", "end_date", "status"],
    orgColumn: false,
  },
  purchase_orders: {
    table: "purchase_orders",
    cols: ["po_id", "vendor_id", "department_id", "requester_user_id", "issue_date", "description", "total_amount", "currency", "status", "approved_by"],
    orgColumn: false,
  },
};

// Organization setup a Brim employee enters for a customer: departments, users, accounts, policies, vendors, contracts, POs.
export async function importRecords(actor: User | null, organizationId: string, kind: string, rows: Row[]) {
  assertCan(actor, "org.manage");
  if (kind === "department_managers") {
    await tx(async (c) => {
      for (const row of rows) {
        await query("UPDATE departments SET manager_user_id=$2 WHERE department_id=$1 AND organization_id=$3", [row.department_id, row.manager_user_id, organizationId], c);
        await writeAudit(c, { organizationId, actor, action: "department.manager", entityType: "department", entityId: String(row.department_id), after: row });
      }
    });
    return;
  }
  const spec = COLUMNS[kind];
  if (!spec) throw new ForbiddenError(`Unknown record kind ${kind}`);
  await tx(async (c) => {
    await c.query("SET CONSTRAINTS ALL DEFERRED");
    for (const row of rows) {
      const cols = spec.orgColumn ? ["organization_id", ...spec.cols] : spec.cols;
      const vals = cols.map((col) => (col === "organization_id" ? organizationId : row[col] === "" || row[col] === undefined ? null : row[col]));
      // self-references (managers, delegates) are filled in a second pass
      const deferred = kind === "users" ? ["manager_id", "delegate_user_id"] : [];
      const insertVals = vals.map((v, i) => (deferred.includes(cols[i]) ? null : v));
      await query(
        `INSERT INTO ${spec.table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
        insertVals,
        c,
      );
      await writeAudit(c, { organizationId, actor, action: `${kind}.import`, entityType: kind, entityId: String(row[spec.cols[0]]), after: row });
    }
    if (kind === "users") {
      for (const row of rows) {
        await query("UPDATE users SET manager_id=$2, delegate_user_id=$3 WHERE user_id=$1", [row.user_id, row.manager_id || null, row.delegate_user_id || null], c);
      }
    }
  });
}

export async function saveUser(actor: User | null, input: Partial<User> & { user_id?: string }) {
  assertCan(actor, "users.manage");
  return tx(async (c) => {
    if (input.role === "brim_employee") throw new ForbiddenError("Cannot create Brim employees");
    if (input.user_id) {
      const before = await one<User>("SELECT * FROM users WHERE user_id = $1", [input.user_id], c);
      if (!before) throw new ForbiddenError("No such user");
      assertOrg(actor, before.organization_id);
      await query(
        `UPDATE users SET full_name=$2, email=$3, title=$4, department_id=$5, manager_id=$6, role=$7, approval_limit_cad=$8,
           work_province=$9, status=$10, delegate_user_id=$11 WHERE user_id=$1`,
        [input.user_id, input.full_name, input.email, input.title, input.department_id || null, input.manager_id || null, input.role,
          input.approval_limit_cad ?? 0, input.work_province, input.status, input.delegate_user_id || null],
        c,
      );
      await writeAudit(c, { organizationId: actor.organization_id, actor, action: "user.update", entityType: "user", entityId: input.user_id, before, after: input });
      return input.user_id;
    }
    const id = await nextId("U", c);
    await query(
      `INSERT INTO users (user_id, organization_id, full_name, email, title, department_id, manager_id, role, approval_limit_cad, work_province, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')`,
      [id, actor.organization_id, input.full_name, input.email, input.title, input.department_id || null, input.manager_id || null, input.role, input.approval_limit_cad ?? 0, input.work_province],
      c,
    );
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "user.create", entityType: "user", entityId: id, after: input });
    return id;
  });
}

// Removing a user who appears on records keeps the row (marked terminated) so the history stays readable.
export async function removeUser(actor: User | null, userId: string) {
  assertCan(actor, "users.manage");
  await tx(async (c) => {
    const before = await one<User>("SELECT * FROM users WHERE user_id = $1", [userId], c);
    if (!before) return;
    assertOrg(actor, before.organization_id);
    if (before.user_id === actor.user_id) throw new ForbiddenError("Cannot remove yourself");
    await query("UPDATE users SET status='terminated', status_since=current_date WHERE user_id=$1", [userId], c);
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "user.remove", entityType: "user", entityId: userId, before });
  });
}

export async function savePolicy(actor: User | null, ruleId: string, input: { trigger_value: number | null; step_role: string | null; is_active: boolean }) {
  assertCan(actor, "policies.manage");
  await tx(async (c) => {
    const before = await one("SELECT * FROM approval_policies WHERE organization_id=$1 AND rule_id=$2", [actor.organization_id, ruleId], c);
    if (!before) throw new ForbiddenError("No such policy");
    await query(
      "UPDATE approval_policies SET trigger_value=$3, step_role=$4, is_active=$5, updated_by=$6, updated_at=now() WHERE organization_id=$1 AND rule_id=$2",
      [actor.organization_id, ruleId, input.trigger_value, input.step_role, input.is_active, actor.user_id],
      c,
    );
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "policy.update", entityType: "approval_policy", entityId: ruleId, before, after: input });
  });
}
