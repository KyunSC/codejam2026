/**
 * Who is calling and for which organization.
 *
 * - A person at an organization: the login cookie (src/lib/auth/session.ts). It only counts for
 *   that person's own organization.
 * - Brim staff: the staff login cookie, or `Authorization: Bearer <BRIM_ADMIN_TOKEN>` for scripts
 *   (and for a future inbox poller). Either one may act in any organization.
 */
import { timingSafeEqual } from "node:crypto";
import type { Organization, User } from "@/generated/prisma/client";
import type { Actor } from "./audit";
import { readStaffSession, readUserSession } from "./auth/session";
import { db } from "./db";
import { AppError } from "./http";

export function hasAdminToken(request: Request): boolean {
  const token = process.env.BRIM_ADMIN_TOKEN?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!token || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A Brim admin actor from the staff cookie or the admin token, or null. */
export async function brimAdminActor(request: Request): Promise<Actor | null> {
  if (hasAdminToken(request)) return { type: "brim_admin" };
  const staff = await readStaffSession();
  return staff ? { type: "brim_admin", staffId: staff.id } : null;
}

export async function requireBrimAdmin(request: Request): Promise<Actor> {
  const actor = await brimAdminActor(request);
  if (!actor) throw new AppError(401, "NOT_BRIM_ADMIN", "Log in as Brim staff.");
  return actor;
}

export async function getOrganization(slug: string): Promise<Organization> {
  const org = await db().organization.findUnique({ where: { slug } });
  if (!org) throw new AppError(404, "ORG_NOT_FOUND", `No organization "${slug}".`);
  return org;
}

/** Finds a user of this organization by id or by the organization's own id for them. */
export async function findUser(organizationId: string, idOrExternalId: string): Promise<User | null> {
  return db().user.findFirst({
    where: { organizationId, OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }] },
  });
}

export interface Caller {
  org: Organization;
  actor: Actor;
  /** The calling user; null for a Brim admin. */
  user: User | null;
}

/** The organization in the path, and who is calling. Throws 401 when nobody is logged in for it. */
export async function getCaller(request: Request, slug: string): Promise<Caller> {
  const org = await getOrganization(slug);
  const session = await readUserSession();
  if (session && session.org.id === org.id) {
    return { org, actor: { type: "user", userId: session.user.id }, user: session.user };
  }
  const admin = await brimAdminActor(request);
  if (admin) return { org, actor: admin, user: null };
  throw new AppError(401, "NOT_LOGGED_IN", `Log in to ${org.name} first.`);
}
