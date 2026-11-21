import { startUserSession } from "@/lib/auth/session";
import { logIn } from "@/lib/auth/service";
import { handle, json, readJson } from "@/lib/http";

/** POST /api/auth/login { email, password, organization? }: sets the login cookie. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await logIn(await readJson(request));
    await startUserSession(user);
    return json({ ok: true, redirect: "/invoices" });
  });
}
