import { endUserSession } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

/** POST /api/auth/logout: clears the login cookie. */
export async function POST() {
  return handle(async () => {
    await endUserSession();
    return json({ ok: true, redirect: "/" });
  });
}
