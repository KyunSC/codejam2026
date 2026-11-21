/**
 * Login sessions: a signed cookie per kind of login.
 *
 * - brim_user:  a person at an organization ({ uid, oid }).
 * - brim_staff: a Brim staff member ({ sid }), for the admin pages.
 *
 * The cookie holds base64url(JSON payload) + "." + HMAC-SHA256 signature with SESSION_SECRET,
 * and an expiry inside the payload. It is httpOnly, so page scripts cannot read it.
 * Every read re-loads the person from the database, so a terminated user is out at once.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { BrimStaff, Organization, User } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const USER_COOKIE = "brim_user";
export const STAFF_COOKIE = "brim_staff";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type UserPayload = { uid: string; oid: string; exp: number };
type StaffPayload = { sid: string; exp: number };

/**
 * The signing key: SESSION_SECRET, or, when a deployment has none configured, a key derived from
 * DATABASE_URL. That URL holds the database password and never leaves the server, so the derived
 * key is as private as the database itself.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s) return s;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) throw new Error("Neither SESSION_SECRET nor DATABASE_URL is set. Put a long random string in SESSION_SECRET.");
  return createHash("sha256").update(`brim-session-v1\n${dbUrl}`).digest("hex");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function seal(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unseal<T extends { exp: number }>(value: string | undefined): T | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

const expiry = () => Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;

/** Route handlers only: sets the login cookie for a user. */
export async function startUserSession(user: User): Promise<void> {
  (await cookies()).set(USER_COOKIE, seal({ uid: user.id, oid: user.organizationId, exp: expiry() }), cookieOptions);
}

export async function startStaffSession(staff: BrimStaff): Promise<void> {
  (await cookies()).set(STAFF_COOKIE, seal({ sid: staff.id, exp: expiry() }), cookieOptions);
}

export async function endUserSession(): Promise<void> {
  (await cookies()).delete(USER_COOKIE);
}

export async function endStaffSession(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
}

export interface SessionUser {
  user: User;
  org: Organization;
}

/** The logged-in user and their organization, or null. Terminated users and pending ones count as logged out. */
export async function readUserSession(): Promise<SessionUser | null> {
  await connection(); // the expiry check reads the clock, so this never runs at prerender time
  const payload = unseal<UserPayload>((await cookies()).get(USER_COOKIE)?.value);
  if (!payload) return null;
  const user = await db().user.findUnique({ where: { id: payload.uid }, include: { organization: true } });
  if (!user || user.organizationId !== payload.oid || user.status === "terminated") return null;
  const { organization, ...rest } = user;
  return { user: rest, org: organization };
}

export async function readStaffSession(): Promise<BrimStaff | null> {
  await connection();
  const payload = unseal<StaffPayload>((await cookies()).get(STAFF_COOKIE)?.value);
  if (!payload) return null;
  return db().brimStaff.findUnique({ where: { id: payload.sid } });
}
