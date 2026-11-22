import { NextResponse } from "next/server";
import { getUser } from "./auth";
import { ForbiddenError } from "./authz";
import type { User } from "./types";

// Route handler wrapper: the signed-in user, and service errors turned into JSON responses.
export function handler<C>(fn: (req: Request, user: User | null, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await getUser();
      const out = await fn(req, user, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof ForbiddenError ? 403 : 500;
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
    }
  };
}
