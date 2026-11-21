/**
 * Account requests. Anyone can ask for an account at an organization; a controller/admin
 * there approves it (creating the user with the role they choose) or rejects it.
 */
import type { AccessRequest, Role } from "@/generated/prisma/client";
import { type Actor, logAction } from "@/lib/audit";
import { assertPasswordOk, hashPassword } from "@/lib/auth/password";
import { getOrganization } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { ROLES, createUser } from "@/lib/users/service";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The request without its password hash. */
export type PublicAccessRequest = Omit<AccessRequest, "passwordHash">;

function publicRequest(r: AccessRequest): PublicAccessRequest {
  const rest: Partial<AccessRequest> = { ...r };
  delete rest.passwordHash;
  return rest as PublicAccessRequest;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function role(v: unknown, field: string): Role | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !ROLES.includes(v as Role)) {
    throw new AppError(422, "BAD_FIELD", `${field}: must be one of ${ROLES.join(", ")}`);
  }
  return v as Role;
}

/** Public: a person asks for an account. Needs the organization's ID (slug). */
export async function requestAccess(input: Record<string, unknown>): Promise<PublicAccessRequest> {
  const slug = text(input.organization);
  if (!slug) throw new AppError(422, "BAD_FIELD", "organization: enter your organization's ID.");
  const org = await getOrganization(slug).catch(() => {
    throw new AppError(422, "BAD_FIELD", `organization: no organization with ID "${slug}".`);
  });
  const fullName = text(input.fullName);
  const email = text(input.email).toLowerCase();
  if (!fullName) throw new AppError(422, "BAD_FIELD", "fullName: is required");
  if (!EMAIL.test(email)) throw new AppError(422, "BAD_FIELD", "email: must be an email address");
  assertPasswordOk(input.password);

  if (await db().user.findFirst({ where: { organizationId: org.id, email } })) {
    throw new AppError(409, "ALREADY_A_USER", `${email} already has an account at ${org.name}. Log in instead.`);
  }
  if (await db().accessRequest.findFirst({ where: { organizationId: org.id, email, status: "pending" } })) {
    throw new AppError(409, "ALREADY_REQUESTED", `${email} already has a request waiting at ${org.name}.`);
  }

  const created = await db().$transaction(async (tx) => {
    const r = await tx.accessRequest.create({
      data: {
        organizationId: org.id,
        fullName,
        email,
        requestedRole: role(input.requestedRole, "requestedRole"),
        message: text(input.message) || null,
        passwordHash: await hashPassword(input.password as string),
      },
    });
    await logAction(tx, {
      organizationId: org.id,
      actor: { type: "system" },
      action: "access_request.created",
      entityType: "access_request",
      entityId: r.id,
      after: publicRequest(r),
    });
    return r;
  });
  return publicRequest(created);
}

export async function listAccessRequests(organizationId: string, f: { status?: string; q?: string } = {}) {
  const status = ["pending", "approved", "rejected"].includes(f.status ?? "") ? (f.status as AccessRequest["status"]) : undefined;
  const q = f.q?.trim();
  const rows = await db().accessRequest.findMany({
    where: {
      organizationId,
      status,
      OR: q ? [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] : undefined,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(publicRequest);
}

async function pending(organizationId: string, id: string) {
  const r = await db().accessRequest.findFirst({ where: { id, organizationId } });
  if (!r) throw new AppError(404, "REQUEST_NOT_FOUND", "No such request.");
  if (r.status !== "pending") throw new AppError(409, "ALREADY_DECIDED", `This request was already ${r.status}.`);
  return r;
}

/** Creates the user with the role the approver picked (default: the one asked for). */
export async function approveAccessRequest(organizationId: string, actor: Actor, id: string, input: Record<string, unknown>) {
  const r = await pending(organizationId, id);
  const chosen = role(input.role, "role") ?? r.requestedRole;
  if (!chosen) throw new AppError(422, "BAD_FIELD", "role: pick the role to give this person.");
  const actorUserId = actor.type === "user" ? actor.userId : null;
  return db().$transaction(async (tx) => {
    // The request already holds the hashed password the person chose.
    const user = await createUser(
      organizationId,
      actor,
      {
        fullName: r.fullName,
        email: r.email,
        role: chosen,
        departmentId: input.departmentId ?? null,
        managerId: input.managerId || null,
        title: input.title ?? null,
      },
      { passwordHash: r.passwordHash, tx },
    );
    const after = await tx.accessRequest.update({
      where: { id: r.id },
      data: { status: "approved", decidedById: actorUserId, decidedAt: new Date(), userId: user.id, decisionNote: text(input.note) || null },
    });
    await logAction(tx, {
      organizationId,
      actor,
      action: "access_request.approved",
      entityType: "access_request",
      entityId: r.id,
      before: publicRequest(r),
      after: publicRequest(after),
    });
    return { request: publicRequest(after), user };
  });
}

export async function rejectAccessRequest(organizationId: string, actor: Actor, id: string, input: Record<string, unknown>) {
  const r = await pending(organizationId, id);
  return db().$transaction(async (tx) => {
    const after = await tx.accessRequest.update({
      where: { id: r.id },
      data: {
        status: "rejected",
        decidedById: actor.type === "user" ? actor.userId : null,
        decidedAt: new Date(),
        decisionNote: text(input.note) || null,
      },
    });
    await logAction(tx, {
      organizationId,
      actor,
      action: "access_request.rejected",
      entityType: "access_request",
      entityId: r.id,
      before: publicRequest(r),
      after: publicRequest(after),
      reason: text(input.note) || null,
    });
    return publicRequest(after);
  });
}
