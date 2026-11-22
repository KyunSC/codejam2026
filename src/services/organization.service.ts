import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { query, tx, nextId, one, type Db } from "@/lib/db";
import { assertCan, assertMember, authorize } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { blankToNull } from "@/lib/values";
import { setPassword } from "./auth.service";
import type { User } from "@/lib/types";
import { window, type Paging } from "@/lib/paging";

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

export async function createOrganization(actor: User | null, input: { legal_name: string; gst_hst_number?: string | null; base_currency?: string }) {
  assertCan(actor, "org.manage");
  return tx(async (c) => {
    const id = await nextId("ORG", c);
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

const USER_FIELDS = ["full_name", "email", "title", "department_id", "manager_id", "role", "approval_limit_cad", "work_province", "status", "delegate_user_id"] as const;
// `password` sets the user's password; it is never stored with the user or written to the audit log.
type UserInput = Partial<Record<(typeof USER_FIELDS)[number], unknown>> & { user_id?: string; password?: unknown };

function checkUserFields(f: Record<string, unknown>) {
  if ("approval_limit_cad" in f && Number(f.approval_limit_cad) < 0) throw new ValidationError("An approval limit cannot be negative.");
  if ("email" in f && !/^[^@\s]+@[^@\s]+$/.test(String(f.email ?? ""))) throw new ValidationError("Give a valid email.");
}

// Each organization keeps at least one controller / admin, who manages its users and policies.
async function keepOneAdmin(c: Db, organizationId: string, leavingUserId: string) {
  const other = await one("SELECT 1 FROM users WHERE organization_id=$1 AND role='controller_admin' AND status<>'terminated' AND user_id<>$2", [organizationId, leavingUserId], c);
  if (!other) throw new ConflictError("This is the organization's last controller / admin; make someone else one first.");
}

// The organization's users, removed ones last.
export async function listUsers(actor: User | null, organizationId: string, f: Paging = {}) {
  assertMember(actor, organizationId, { brim: true });
  const { limit, offset } = window(f);
  return query<User & { total_count: number }>(
    `SELECT *, count(*) OVER ()::int AS total_count FROM users WHERE organization_id=$1 ORDER BY status='terminated', full_name LIMIT ${limit} OFFSET ${offset}`,
    [organizationId],
  );
}

// Everyone in the organization, with what a picker needs: for choosing a requester, manager or delegate.
export async function listUserChoices(actor: User | null, organizationId: string) {
  assertMember(actor, organizationId, { brim: true });
  return query<Pick<User, "user_id" | "full_name" | "title" | "role" | "status" | "department_id">>(
    "SELECT user_id, full_name, title, role, status, department_id FROM users WHERE organization_id=$1 ORDER BY status='terminated', full_name",
    [organizationId],
  );
}

export async function getOrgUser(actor: User | null, organizationId: string, userId: string) {
  assertMember(actor, organizationId, { brim: true });
  const u = await one<User>("SELECT * FROM users WHERE organization_id=$1 AND user_id=$2", [organizationId, userId]);
  if (!u) throw new NotFoundError("No such user");
  return u;
}

export async function createUser(actor: User | null, organizationId: string, input: UserInput) {
  authorize(actor, organizationId, "users.manage");
  if (input.role === "brim_employee") throw new ValidationError("Cannot create Brim employees");
  const { password, ...fields } = input;
  if (typeof password !== "string") throw new ValidationError("Give the new user a password");
  checkUserFields(fields);
  return tx(async (c) => {
    const id = await nextId("U", c);
    const cols = USER_FIELDS.filter((f) => f in input);
    await query(
      `INSERT INTO users (user_id, organization_id, ${cols.join(",")}) VALUES ($1,$2,${cols.map((_, i) => `$${i + 3}`).join(",")})`,
      [id, organizationId, ...cols.map((f) => blankToNull(input[f]))],
      c,
    );
    await setPassword(c, id, password);
    await writeAudit(c, { organizationId, actor, action: "user.create", entityType: "user", entityId: id, after: fields });
    return id;
  });
}

export async function updateUser(actor: User | null, organizationId: string, userId: string, input: UserInput) {
  authorize(actor, organizationId, "users.manage");
  if (input.role === "brim_employee") throw new ValidationError("Cannot make a Brim employee");
  const { password, ...fields } = input;
  checkUserFields(fields);
  await tx(async (c) => {
    const before = await one<User>("SELECT * FROM users WHERE user_id=$1 AND organization_id=$2 FOR UPDATE", [userId, organizationId], c);
    if (!before) throw new NotFoundError("No such user");
    if (userId === actor.user_id && "role" in fields && fields.role !== before.role) throw new ForbiddenError("You cannot change your own role.");
    if (before.role === "controller_admin" && "role" in fields && fields.role !== "controller_admin") await keepOneAdmin(c, organizationId, userId);
    const cols = USER_FIELDS.filter((f) => f in fields);
    if (cols.length) {
      await query(`UPDATE users SET ${cols.map((f, i) => `${f}=$${i + 2}`).join(", ")} WHERE user_id=$1`, [userId, ...cols.map((f) => blankToNull(fields[f]))], c);
      await writeAudit(c, { organizationId, actor, action: "user.update", entityType: "user", entityId: userId, before, after: fields });
    }
    if (typeof password === "string" && password) {
      await setPassword(c, userId, password);
      await writeAudit(c, { organizationId, actor, action: "user.password_set", entityType: "user", entityId: userId });
    }
  });
}

// Removing a user keeps the row, marked terminated, so the records they appear on stay readable.
export async function deleteUser(actor: User | null, organizationId: string, userId: string) {
  authorize(actor, organizationId, "users.manage");
  await tx(async (c) => {
    const before = await one<User>("SELECT * FROM users WHERE user_id=$1 AND organization_id=$2 FOR UPDATE", [userId, organizationId], c);
    if (!before) throw new NotFoundError("No such user");
    if (before.user_id === actor.user_id) throw new ForbiddenError("Cannot remove yourself");
    if (before.role === "controller_admin") await keepOneAdmin(c, organizationId, userId);
    await query("UPDATE users SET status='terminated', status_since=$2 WHERE user_id=$1", [userId, today()], c);
    await writeAudit(c, { organizationId, actor, action: "user.delete", entityType: "user", entityId: userId, before });
  });
}
