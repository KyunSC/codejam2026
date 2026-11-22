import { randomBytes } from "crypto";
import { nextId, one, query, tx, type Db } from "@/lib/db";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { tokenHash } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

const MIN_LENGTH = 8;

// Sign-in by email and password. Brim employees sign in on the employee login ("brim"), everyone else on the organization login;
// without a portal (the dataset loader) any active account may sign in.
export async function signIn(email: string, password: string, portal?: "brim" | "organization") {
  const user = await one<{ user_id: string; role: string; organization_id: string | null; password_hash: string | null }>(
    `SELECT u.user_id, u.role, u.organization_id, p.password_hash FROM users u LEFT JOIN user_passwords p USING (user_id)
      WHERE lower(u.email)=lower($1) AND u.status<>'terminated'`,
    [email],
  );
  const ok = !!user && (await verifyPassword(password, user.password_hash));
  const brim = user?.role === "brim_employee";
  if (!ok || (portal === "brim" && !brim) || (portal === "organization" && brim)) throw new UnauthorizedError("Wrong email or password.");
  return { user_id: user.user_id, role: user.role, organization_id: user.organization_id };
}

// Sets a user's password, inside the caller's transaction.
export async function setPassword(db: Db, userId: string, password: string) {
  if (password.length < MIN_LENGTH) throw new ValidationError(`A password has at least ${MIN_LENGTH} characters.`);
  await query(
    `INSERT INTO user_passwords (user_id, password_hash) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, updated_at=now()`,
    [userId, await hashPassword(password)],
    db,
  );
}

// The signed-in user changes their own password, giving the current one.
export async function changeOwnPassword(actor: User | null, current: string, next: string) {
  if (!actor) throw new UnauthorizedError("Sign in");
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM user_passwords WHERE user_id=$1", [actor.user_id]);
  if (!(await verifyPassword(current, row?.password_hash))) throw new ValidationError("The current password is wrong.");
  await tx(async (c) => {
    await setPassword(c, actor.user_id, next);
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "user.password_change", entityType: "user", entityId: actor.user_id });
  });
}

// --- personal access tokens, for an employee's agent ---

// A new token for the signed-in user. The token itself is returned only here; it acts with the user's own role.
export async function createToken(actor: User | null, name: string) {
  if (!actor) throw new UnauthorizedError("Sign in");
  if (!name.trim()) throw new ValidationError("Name the token after the agent that will use it.");
  const token = `brim_${randomBytes(24).toString("base64url")}`;
  return tx(async (c) => {
    const id = await nextId("TOK", c);
    await query("INSERT INTO api_tokens (token_id, user_id, name, token_hash) VALUES ($1,$2,$3,$4)", [id, actor.user_id, name.trim(), tokenHash(token)], c);
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "token.create", entityType: "api_token", entityId: id, note: name.trim() });
    return { id, token };
  });
}

export function listTokens(actor: User | null) {
  if (!actor) throw new UnauthorizedError("Sign in");
  return query<{ token_id: string; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
    "SELECT token_id, name, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id=$1 ORDER BY revoked_at IS NOT NULL, created_at DESC",
    [actor.user_id],
  );
}

export async function revokeToken(actor: User | null, tokenId: string) {
  if (!actor) throw new UnauthorizedError("Sign in");
  await tx(async (c) => {
    const t = await one("SELECT 1 FROM api_tokens WHERE token_id=$1 AND user_id=$2 AND revoked_at IS NULL", [tokenId, actor.user_id], c);
    if (!t) throw new NotFoundError("No such token");
    await query("UPDATE api_tokens SET revoked_at=now() WHERE token_id=$1", [tokenId], c);
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "token.revoke", entityType: "api_token", entityId: tokenId });
  });
}

// The accounts listed on the login page.
export function listDemoAccounts() {
  return query<{ email: string; full_name: string; role: string; title: string }>(
    "SELECT email, full_name, role, title FROM users WHERE role<>'brim_employee' AND status<>'terminated' ORDER BY role, full_name",
  );
}
