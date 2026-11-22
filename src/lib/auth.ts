import { createHash, createHmac, timingSafeEqual } from "crypto";
import { one, query } from "./db";
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

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

// The user of a personal access token ("Authorization: Bearer brim_…"), or null. Records when the token was last used.
export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token?.startsWith("brim_")) return null;
  const user = await one<User & { token_id: string }>(
    `SELECT u.*, t.token_id FROM api_tokens t JOIN users u USING (user_id) WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND u.status <> 'terminated'`,
    [tokenHash(token)],
  );
  if (!user) return null;
  await query("UPDATE api_tokens SET last_used_at=now() WHERE token_id=$1", [user.token_id]);
  delete (user as Partial<typeof user>).token_id;
  return user;
}

export const bearer = (header: string | undefined) => (header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined);
