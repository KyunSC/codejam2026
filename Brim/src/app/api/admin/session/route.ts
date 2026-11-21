import { endStaffSession, startStaffSession } from "@/lib/auth/session";
import { staffLogIn } from "@/lib/auth/service";
import { handle, json, readJson } from "@/lib/http";

/** POST /api/admin/session { email, password }: Brim staff login. */
export async function POST(request: Request) {
  return handle(async () => {
    await startStaffSession(await staffLogIn(await readJson(request)));
    return json({ ok: true, redirect: "/admin" });
  });
}

/** DELETE /api/admin/session: Brim staff logout. */
export async function DELETE() {
  return handle(async () => {
    await endStaffSession();
    return json({ ok: true, redirect: "/" });
  });
}
