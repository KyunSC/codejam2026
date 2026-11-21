/**
 * Organizations: Brim's customers. Only the Brim admin API calls these.
 * Each change is logged in that organization's own audit log, by actor "brim_admin".
 */
import { type Actor, logAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { createUser } from "@/lib/users/service";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const counts = { _count: { select: { users: true, invoices: true, accessRequests: { where: { status: "pending" as const } } } } };

/** Every organization, newest first, optionally narrowed by name or slug. */
export async function listOrganizations(q?: string) {
  const term = q?.trim();
  return db().organization.findMany({
    where: term
      ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { slug: { contains: term, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: counts,
  });
}

export async function getOrganizationBySlug(slug: string) {
  const org = await db().organization.findUnique({
    where: { slug },
    include: counts,
  });
  if (!org) throw new AppError(404, "ORG_NOT_FOUND", `No organization "${slug}".`);
  return org;
}

/**
 * Onboards an organization. With `admin` ({ fullName, email, password }), also creates its first
 * controller/admin, who can then approve everyone else.
 */
export async function createOrganization(input: Record<string, unknown>, actor: Actor = { type: "brim_admin" }) {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!SLUG.test(slug)) throw new AppError(422, "BAD_SLUG", 'slug: lower-case letters, digits and hyphens, e.g. "harborline".');
  if (!name) throw new AppError(422, "NAME_REQUIRED", "name is required.");
  if (await db().organization.findUnique({ where: { slug } })) {
    throw new AppError(409, "ORG_EXISTS", `An organization "${slug}" already exists.`);
  }
  const admin = input.admin && typeof input.admin === "object" ? (input.admin as Record<string, unknown>) : null;
  return db().$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { slug, name } });
    await logAction(tx, {
      organizationId: org.id,
      actor,
      action: "organization.created",
      entityType: "organization",
      entityId: org.id,
      after: org,
    });
    const firstAdmin = admin
      ? await createUser(org.id, actor, { ...admin, role: "controller_admin" }, { tx })
      : null;
    return { ...org, firstAdmin };
  });
}

/** Only the name can change; the slug is part of every URL and stays fixed. */
export async function updateOrganization(slug: string, input: Record<string, unknown>, actor: Actor = { type: "brim_admin" }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new AppError(422, "NAME_REQUIRED", "name is required.");
  if ("slug" in input) throw new AppError(422, "SLUG_FIXED", "The slug cannot be changed.");
  return db().$transaction(async (tx) => {
    const before = await tx.organization.findUnique({ where: { slug } });
    if (!before) throw new AppError(404, "ORG_NOT_FOUND", `No organization "${slug}".`);
    const after = await tx.organization.update({ where: { id: before.id }, data: { name } });
    await logAction(tx, {
      organizationId: after.id,
      actor,
      action: "organization.updated",
      entityType: "organization",
      entityId: after.id,
      before,
      after,
    });
    return after;
  });
}
