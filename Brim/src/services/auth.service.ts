import { one, query } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";

// Sign-in is by email: the dataset has no passwords.
export function findActiveUserByEmail(email: string) {
  return one<{ user_id: string; role: string; organization_id: string | null }>(
    "SELECT user_id, role, organization_id FROM users WHERE lower(email)=lower($1) AND status<>'terminated'",
    [email],
  );
}

// Sign-in for a login page: Brim employees sign in on the employee login ("brim"), everyone else on the organization login.
// Without a portal (the dataset loader) any active account signs in.
export async function signIn(email: string, portal?: "brim" | "organization") {
  const user = await findActiveUserByEmail(email);
  const brim = user?.role === "brim_employee";
  if (!user || (portal === "brim" && !brim) || (portal === "organization" && brim)) throw new UnauthorizedError("No account with that email here.");
  return user;
}

// The accounts listed on the login page.
export function listDemoAccounts() {
  return query<{ email: string; full_name: string; role: string; title: string }>(
    "SELECT email, full_name, role, title FROM users WHERE role<>'brim_employee' AND status<>'terminated' ORDER BY role, full_name",
  );
}
