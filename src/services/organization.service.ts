import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { query, tx, nextId, one } from "@/lib/db";
import { assertCan, assertMember, authorize } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { blankToNull } from "@/lib/values";
import type { User } from "@/lib/types";

// --- organizations (Brim employees) ---

export type Organization = { organization_id: string; legal_name: string; gst_hst_number: string | null; base_currency: string; created_at: string };

// Every organization with its number of users and invoices.
export async function listOrganizations(actor: User | null) {
  assertCan(actor, "org.manage");
  return query<Organization & { users: number; invoices: number }>(
    `SELECT o.*, (SELECT count(*)::int FROM users u WHERE u.organization_id=o.organization_id) users,
       (SELECT count(*)::int FROM invoices i WHERE i.organization_id=o.organization_id) invoices FROM organizations o ORDER BY o.legal_name`,
  );
}

export async function getOrganization(actor: User | null, id: string) {
  assertMember(actor, id, { brim: true });
  const org = await one<Organization>("SELECT * FROM organizations WHERE organization_id=$1", [id]);
  if (!org) throw new NotFoundError("No such organization");
  return org;
}

export async function createOrganization(actor: User | null, input: { organization_id?: string; legal_name: string; gst_hst_number?: string | null; base_currency?: string }) {
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

export async function updateOrganization(actor: User | null, id: string, input: { legal_name?: string; gst_hst_number?: string | null; base_currency?: string }) {
  assertCan(actor, "org.manage");
  await tx(async (c) => {
    const before = await one<{ legal_name: string; gst_hst_number: string | null; base_currency: string }>("SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE", [id], c);
    if (!before) throw new NotFoundError("No such organization");
    const next = { ...before, ...input };
    await query("UPDATE organizations SET legal_name=$2, gst_hst_number=$3, base_currency=$4 WHERE organization_id=$1", [id, next.legal_name, next.gst_hst_number, next.base_currency], c);
    await writeAudit(c, { organizationId: id, actor, action: "organization.update", entityType: "organization", entityId: id, before, after: input });
  });
}

// --- users ---

const USER_FIELDS = ["full_name", "email", "title", "department_id", "manager_id", "role", "approval_limit_cad", "work_province", "status", "status_since", "delegate_user_id"] as const;
type UserInput = Partial<Record<(typeof USER_FIELDS)[number], unknown>> & { user_id?: string };

// The organization's users, removed ones last.
export async function listUsers(actor: User | null, organizationId: string) {
  assertMember(actor, organizationId, { brim: true });
  return query<User>("SELECT * FROM users WHERE organization_id=$1 ORDER BY status='terminated', full_name", [organizationId]);
}

export async function getOrgUser(actor: User | null, organizationId: string, userId: string) {
  const u = (await listUsers(actor, organizationId)).find((x) => x.user_id === userId);
  if (!u) throw new NotFoundError("No such user");
  return u;
}

export async function createUser(actor: User | null, organizationId: string, input: UserInput) {
  authorize(actor, organizationId, "users.manage");
  if (input.role === "brim_employee") throw new ValidationError("Cannot create Brim employees");
  return tx(async (c) => {
    const id = input.user_id || (await nextId("U", c));
    const cols = USER_FIELDS.filter((f) => f in input);
    await query(
      `INSERT INTO users (user_id, organization_id, ${cols.join(",")}) VALUES ($1,$2,${cols.map((_, i) => `$${i + 3}`).join(",")})`,
      [id, organizationId, ...cols.map((f) => blankToNull(input[f]))],
      c,
    );
    await writeAudit(c, { organizationId, actor, action: "user.create", entityType: "user", entityId: id, after: input });
    return id;
  });
}

export async function updateUser(actor: User | null, organizationId: string, userId: string, input: UserInput) {
  authorize(actor, organizationId, "users.manage");
  if (input.role === "brim_employee") throw new ValidationError("Cannot make a Brim employee");
  await tx(async (c) => {
    const before = await one<User>("SELECT * FROM users WHERE user_id=$1 AND organization_id=$2 FOR UPDATE", [userId, organizationId], c);
    if (!before) throw new NotFoundError("No such user");
    const cols = USER_FIELDS.filter((f) => f in input);
    if (!cols.length) return;
    await query(`UPDATE users SET ${cols.map((f, i) => `${f}=$${i + 2}`).join(", ")} WHERE user_id=$1`, [userId, ...cols.map((f) => blankToNull(input[f]))], c);
    await writeAudit(c, { organizationId, actor, action: "user.update", entityType: "user", entityId: userId, before, after: input });
  });
}

// Removing a user keeps the row, marked terminated, so the records they appear on stay readable.
export async function deleteUser(actor: User | null, organizationId: string, userId: string) {
  authorize(actor, organizationId, "users.manage");
  await tx(async (c) => {
    const before = await one<User>("SELECT * FROM users WHERE user_id=$1 AND organization_id=$2 FOR UPDATE", [userId, organizationId], c);
    if (!before) throw new NotFoundError("No such user");
    if (before.user_id === actor.user_id) throw new ForbiddenError("Cannot remove yourself");
    await query("UPDATE users SET status='terminated', status_since=current_date WHERE user_id=$1", [userId], c);
    await writeAudit(c, { organizationId, actor, action: "user.delete", entityType: "user", entityId: userId, before });
  });
}
