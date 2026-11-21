/**
 * For pages: the logged-in user or staff member, or a redirect to the right login page.
 * Pages call these inside a <Suspense> boundary, because they read the request's cookies.
 */
import { redirect } from "next/navigation";
import { type SessionUser, readStaffSession, readUserSession } from "./session";

export async function requireUser(): Promise<SessionUser> {
  const session = await readUserSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireStaff() {
  const staff = await readStaffSession();
  if (!staff) redirect("/admin/login");
  return staff;
}
