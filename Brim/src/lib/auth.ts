import { createHmac, timingSafeEqual } from "crypto";
import { one } from "./db";
import type { User } from "./types";

// The session cookie holds the user id and its HMAC signature.
export const SESSION_COOKIE = "session";

function sign(userId: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(userId).digest("hex");
}

export function sessionValue(userId: string) {
  return `${userId}.${sign(userId)}`;
}

function userIdFromSession(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

// The signed-in user for a session cookie value, or null.
export async function userFromSession(value: string | undefined): Promise<User | null> {
  const id = userIdFromSession(value);
  if (!id) return null;
  return one<User>("SELECT * FROM users WHERE user_id = $1 AND status <> 'terminated'", [id]);
}
