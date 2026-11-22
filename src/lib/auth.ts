import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "./db";
import type { User } from "./types";

const COOKIE = "session";

function sign(userId: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(userId).digest("hex");
}

export function sessionValue(userId: string) {
  return `${userId}.${sign(userId)}`;
}

export function userIdFromSession(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export async function getUser(): Promise<User | null> {
  const store = await cookies();
  const id = userIdFromSession(store.get(COOKIE)?.value);
  if (!id) return null;
  return one<User>("SELECT * FROM users WHERE user_id = $1 AND status <> 'terminated'", [id]);
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, sessionValue(userId), { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}
