import { Router } from "express";
import { SESSION_COOKIE, sessionValue } from "@/lib/auth";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { changeOwnPassword, createToken, listDemoAccounts, listTokens, revokeToken, signIn } from "@/services/auth.service";
import { setDelegate } from "@/services/approval.service";
import { route } from "../http";

export const session = Router();

// The signed-in user.
session.get("/session", route(async ({ user }) => {
  if (!user) throw new UnauthorizedError("Sign in");
  return user;
}));

// Sign in with email and password. `portal` limits the login to Brim employees ("brim") or to organization users ("organization").
session.post("/session", route(async ({ res, body }) => {
  const portal = body.portal === "brim" || body.portal === "organization" ? body.portal : null;
  if (!portal) throw new ValidationError('Say which login: "organization" or "brim".');
  const user = await signIn(String(body.email ?? ""), String(body.password ?? ""), portal);
  res.cookie(SESSION_COOKIE, sessionValue(user.user_id), { httpOnly: true, sameSite: "lax", path: "/" });
  return user;
}));

session.delete("/session", route(async ({ res }) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}));

// The accounts listed on the login page.
session.get("/session/demo-accounts", route(async () => listDemoAccounts()));
// Signs in as one of those accounts with the demo password set on the server (DEMO_PASSWORD), so clicking a name is enough.
session.post("/session/demo", route(async ({ res, body }) => {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new ValidationError("Signing in by clicking an account is not set up on this server.");
  const user = await signIn(String(body.email ?? ""), password, "organization");
  res.cookie(SESSION_COOKIE, sessionValue(user.user_id), { httpOnly: true, sameSite: "lax", path: "/" });
  return user;
}));

// Change your own password.
session.put("/me/password", route(async ({ user, body }) => changeOwnPassword(user, String(body.current_password ?? ""), String(body.new_password ?? ""))));

// Personal access tokens for your agents: the new token is in the response once.
session.get("/me/tokens", route(async ({ user }) => listTokens(user)));
session.post("/me/tokens", route(async ({ user, body }) => createToken(user, String(body.name ?? ""))));
session.delete("/me/tokens/:id", route(async ({ user, params }) => revokeToken(user, params.id)));

// Go on leave and name the delegate who approves for you.
session.put("/me/delegation", route(async ({ user, body }) => {
  if (!body.delegate_user_id) throw new ValidationError("delegate_user_id is required");
  await setDelegate(user, true, String(body.delegate_user_id));
}, { gate: "delegate.set" }));

// Back from leave.
session.delete("/me/delegation", route(async ({ user }) => {
  await setDelegate(user, false, null);
}, { gate: "delegate.set" }));
