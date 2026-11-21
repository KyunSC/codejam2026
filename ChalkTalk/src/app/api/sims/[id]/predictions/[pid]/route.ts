import { MAX_ANSWER_CHARS, badRequest } from "@/lib/api";
import { storageErrorResponse } from "@/lib/db";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f]{32}$/;

/** The student's reflection after Run: what actually happened. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sims/[id]/predictions/[pid]">) {
  const { id, pid } = await ctx.params;
  if (!ID.test(id) || !/^([0-9a-f]{12}|[0-9a-f]{32})$/.test(pid)) return badRequest("Unknown prediction.", 404);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const observed = typeof body?.observed === "string" ? body.observed.trim() : "";
  if (!observed) return badRequest('"observed" is required.');
  if (observed.length > MAX_ANSWER_CHARS) return badRequest('"observed" is too long.', 413);
  let entry;
  try {
    entry = await store().setObserved(id, pid, observed);
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!entry) return badRequest("Unknown prediction.", 404);
  return Response.json({ prediction: entry });
}
