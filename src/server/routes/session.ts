import { Router } from "express";
import { SESSION_COOKIE, sessionValue } from "@/lib/auth";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { listDemoAccounts, signIn } from "@/services/auth.service";
import { setDelegate } from "@/services/approval.service";
import { route } from "../http";

export const session = Router();

// The signed-in user.
session.get("/session", route(async ({ user }) => {
  if (!user) throw new UnauthorizedError("Sign in");
  return user;
}));

// Sign in by email (the dataset has no passwords). `portal` limits the login to Brim employees ("brim") or to organization users ("organization").
session.post("/session", route(async ({ res, body }) => {
  const portal = body.portal === "brim" || body.portal === "organization" ? body.portal : undefined;
  const user = await signIn(String(body.email ?? ""), portal);
  res.cookie(SESSION_COOKIE, sessionValue(user.user_id), { httpOnly: true, sameSite: "lax", path: "/" });
  return user;
}));

session.delete("/session", route(async ({ res }) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}));

// The accounts listed on the login page.
session.get("/session/demo-accounts", route(async () => listDemoAccounts()));

// Go on leave and name the delegate who approves for you.
session.put("/me/delegation", route(async ({ user, body }) => {
  if (!body.delegate_user_id) throw new ValidationError("delegate_user_id is required");
  await setDelegate(user, true, String(body.delegate_user_id));
}, { gate: "delegate.set" }));

// Back from leave.
session.delete("/me/delegation", route(async ({ user }) => {
  await setDelegate(user, false, null);
}, { gate: "delegate.set" }));
