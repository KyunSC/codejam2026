/**
 * Logging in, for people at an organization and for Brim staff.
 * A failed login says only "wrong email or password", whichever part was wrong.
 */
import type { BrimStaff, User } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { assertPasswordOk, hashPassword, verifyPassword } from "./password";

const WRONG = () => new AppError(401, "WRONG_LOGIN", "Wrong email or password.");

/**
 * Logs a person in by email and password. The same email can exist at two organizations;
 * then `organization` (the slug) picks one, and without it the caller gets the choices.
 */
export async function logIn(input: Record<string, unknown>): Promise<User> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const slug = typeof input.organization === "string" ? input.organization.trim() : "";
  if (!email || !password) throw WRONG();

  const candidates = await db().user.findMany({
    where: { email, status: { not: "terminated" }, organization: slug ? { slug } : undefined },
    include: { organization: true },
  });
  const matches: typeof candidates = [];
  for (const u of candidates) if (await verifyPassword(password, u.passwordHash)) matches.push(u);
  if (matches.length === 0) throw WRONG();
  if (matches.length > 1) {
    const names = matches.map((u) => `${u.organization.name} (${u.organization.slug})`).join(", ");
    throw new AppError(409, "PICK_ORGANIZATION", `This email has accounts at ${names}. Enter the organization ID.`);
  }
  const { organization, ...user } = matches[0];
  await db().$transaction((tx) =>
    logAction(tx, {
      organizationId: organization.id,
      actor: { type: "user", userId: user.id },
      action: "user.logged_in",
      entityType: "user",
      entityId: user.id,
    }),
  );
  return user;
}

export async function staffLogIn(input: Record<string, unknown>): Promise<BrimStaff> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const staff = email ? await db().brimStaff.findUnique({ where: { email } }) : null;
  if (!staff || !(await verifyPassword(password, staff.passwordHash))) throw WRONG();
  return staff;
}

/** Adds a Brim staff member. Used by scripts/create-brim-staff.ts. */
export async function createStaff(input: { email: string; fullName: string; password: string }): Promise<BrimStaff> {
  assertPasswordOk(input.password);
  const email = input.email.trim().toLowerCase();
  if (await db().brimStaff.findUnique({ where: { email } })) {
    throw new AppError(409, "STAFF_EXISTS", `${email} is already Brim staff.`);
  }
  return db().brimStaff.create({
    data: { email, fullName: input.fullName.trim(), passwordHash: await hashPassword(input.password) },
  });
}
