/**
 * Users of one organization: list, read, create, update, delete.
 * Every change is written to the audit log in the same transaction, with the state before and after.
 * Manager and delegate are given by user id or by the organization's own id (e.g. "U003"),
 * and must belong to the same organization.
 */
import type { Prisma, User } from "@/generated/prisma/client";
import { type Actor, logAction } from "@/lib/audit";
import { assertPasswordOk, hashPassword } from "@/lib/auth/password";
import { findUser } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { toIsoDate } from "@/lib/today";

export const ROLES = ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"] as const;
export const STATUSES = ["active", "on_leave", "terminated"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Data = Prisma.UserUncheckedCreateInput;

/** A user without the password hash: what the API returns and the audit log stores. */
export type PublicUser = Omit<User, "passwordHash"> & { canLogIn: boolean };

export function publicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  return { ...rest, canLogIn: !!passwordHash };
}

function bad(field: string, message: string): never {
  throw new AppError(422, "BAD_FIELD", `${field}: ${message}`);
}

function optionalText(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") bad(field, "must be text or null");
  return v.trim() || null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !allowed.includes(v as T)) bad(field, `must be one of ${allowed.join(", ")}`);
  return v as T;
}

function optionalDate(v: unknown, field: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = typeof v === "string" ? toIsoDate(v) : null;
  if (!d) bad(field, "must be a date written YYYY-MM-DD, or null");
  return new Date(`${d}T00:00:00Z`);
}

async function resolveUserRef(organizationId: string, v: unknown, field: string): Promise<string | null | undefined> {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) bad(field, "must be a user id or null");
  const user = await findUser(organizationId, v.trim());
  if (!user) bad(field, `no user "${v}" in this organization`);
  return user.id;
}

/** Reads the fields a caller may set. On create, fullName, email and role are required. */
async function readFields(organizationId: string, input: Record<string, unknown>, creating: boolean) {
  const data: Partial<Data> = {};

  const fullName = optionalText(input.fullName, "fullName");
  if (fullName !== undefined) data.fullName = fullName ?? bad("fullName", "cannot be blank");
  const email = optionalText(input.email, "email");
  if (email !== undefined) {
    if (!email || !EMAIL.test(email)) bad("email", "must be an email address");
    data.email = email.toLowerCase();
  }
  const role = oneOf(input.role, ROLES, "role");
  if (role) data.role = role;
  const status = oneOf(input.status, STATUSES, "status");
  if (status) data.status = status;

  for (const field of ["externalId", "title", "departmentId", "workProvince"] as const) {
    const v = optionalText(input[field], field);
    if (v !== undefined) data[field] = v;
  }
  if (input.approvalLimitCad !== undefined) {
    const n = Number(input.approvalLimitCad);
    if (!Number.isFinite(n) || n < 0) bad("approvalLimitCad", "must be a number, 0 or more");
    data.approvalLimitCad = n.toFixed(2);
  }
  const statusSince = optionalDate(input.statusSince, "statusSince");
  if (statusSince !== undefined) data.statusSince = statusSince;
  const hireDate = optionalDate(input.hireDate, "hireDate");
  if (hireDate !== undefined) data.hireDate = hireDate;
  const managerId = await resolveUserRef(organizationId, input.managerId, "managerId");
  if (managerId !== undefined) data.managerId = managerId;
  const delegateId = await resolveUserRef(organizationId, input.delegateId, "delegateId");
  if (delegateId !== undefined) data.delegateId = delegateId;
  if (input.password !== undefined) {
    assertPasswordOk(input.password);
    data.passwordHash = await hashPassword(input.password);
  }

  if (creating) {
    if (!data.fullName) bad("fullName", "is required");
    if (!data.email) bad("email", "is required");
    if (!data.role) bad("role", "is required");
  }
  return data;
}

async function assertUnique(organizationId: string, data: Partial<Data>, exceptId?: string) {
  const clashes: Prisma.UserWhereInput[] = [];
  if (data.email) clashes.push({ email: data.email });
  if (data.externalId) clashes.push({ externalId: data.externalId });
  if (clashes.length === 0) return;
  const other = await db().user.findFirst({ where: { organizationId, OR: clashes, NOT: exceptId ? { id: exceptId } : undefined } });
  if (other) throw new AppError(409, "USER_EXISTS", `User ${other.id} already has that email or external id.`);
}

export interface UserFilter {
  /** Matches name, email, title or the organization's own id. */
  q?: string;
  role?: string;
  status?: string;
  departmentId?: string;
}

export async function listUsers(organizationId: string, f: UserFilter = {}): Promise<PublicUser[]> {
  const q = f.q?.trim();
  const users = await db().user.findMany({
    where: {
      organizationId,
      role: ROLES.includes(f.role as (typeof ROLES)[number]) ? (f.role as (typeof ROLES)[number]) : undefined,
      status: STATUSES.includes(f.status as (typeof STATUSES)[number]) ? (f.status as (typeof STATUSES)[number]) : undefined,
      departmentId: f.departmentId || undefined,
      OR: q
        ? ["fullName", "email", "title", "externalId"].map((k) => ({ [k]: { contains: q, mode: "insensitive" as const } }))
        : undefined,
    },
    orderBy: [{ externalId: "asc" }, { createdAt: "asc" }],
  });
  return users.map(publicUser);
}

/** Full row, including the password hash. Server code only; send publicUser() to clients. */
export async function getUser(organizationId: string, idOrExternalId: string): Promise<User> {
  const user = await findUser(organizationId, idOrExternalId);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", `No user "${idOrExternalId}".`);
  return user;
}

/**
 * `opts.passwordHash` sets an already-hashed password (an approved access request).
 * `opts.tx` runs inside the caller's transaction instead of a new one.
 */
export async function createUser(
  organizationId: string,
  actor: Actor,
  input: Record<string, unknown>,
  opts: { passwordHash?: string; tx?: Prisma.TransactionClient } = {},
) {
  const data = await readFields(organizationId, input, true);
  if (opts.passwordHash) data.passwordHash = opts.passwordHash;
  await assertUnique(organizationId, data);
  const run = async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({ data: { ...(data as Data), organizationId } });
    await logAction(tx, { organizationId, actor, action: "user.created", entityType: "user", entityId: user.id, after: publicUser(user) });
    return publicUser(user);
  };
  return opts.tx ? run(opts.tx) : db().$transaction(run);
}

export async function updateUser(organizationId: string, actor: Actor, idOrExternalId: string, input: Record<string, unknown>) {
  const before = await getUser(organizationId, idOrExternalId);
  const data = await readFields(organizationId, input, false);
  if (Object.keys(data).length === 0) throw new AppError(422, "NOTHING_TO_UPDATE", "Send at least one field to change.");
  if (data.managerId === before.id) bad("managerId", "a user cannot manage themselves");
  if (data.delegateId === before.id) bad("delegateId", "a user cannot be their own delegate");
  await assertUnique(organizationId, data, before.id);
  return db().$transaction(async (tx) => {
    const after = await tx.user.update({ where: { id: before.id }, data });
    await logAction(tx, {
      organizationId,
      actor,
      action: data.passwordHash ? "user.password_set" : "user.updated",
      entityType: "user",
      entityId: after.id,
      before: publicUser(before),
      after: publicUser(after),
    });
    return publicUser(after);
  });
}

/** Deletes a user nothing refers to. Someone with submissions, reports or delegations stays; set status instead. */
export async function deleteUser(organizationId: string, actor: Actor, idOrExternalId: string) {
  const user = await getUser(organizationId, idOrExternalId);
  const [submissions, reports, delegatingFor] = await Promise.all([
    db().invoice.count({ where: { OR: [{ createdById: user.id }, { assignedToId: user.id }] } }),
    db().user.count({ where: { managerId: user.id } }),
    db().user.count({ where: { delegateId: user.id } }),
  ]);
  if (submissions + reports + delegatingFor > 0) {
    throw new AppError(
      409,
      "USER_IN_USE",
      `${user.fullName} has ${submissions} invoices, ${reports} reports and is delegate for ${delegatingFor}. Set status to "terminated" instead.`,
    );
  }
  await db().$transaction(async (tx) => {
    await tx.user.delete({ where: { id: user.id } });
    await logAction(tx, { organizationId, actor, action: "user.deleted", entityType: "user", entityId: user.id, before: publicUser(user) });
  });
}
