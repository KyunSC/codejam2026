import { MAX_ANSWER_CHARS, MAX_NAME_CHARS, badRequest } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[0-9a-f]{12}$/;

/** A student's prediction, posted from /s/[id] when they press Run. */
export async function POST(req: Request, ctx: RouteContext<"/api/sims/[id]/predictions">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return badRequest("Unknown simulation.", 404);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const prediction = typeof body?.prediction === "string" ? body.prediction.trim() : "";
  if (!prediction) return badRequest('"prediction" is required.');
  if (prediction.length > MAX_ANSWER_CHARS) return badRequest('"prediction" is too long.', 413);
  const rawName = typeof body?.name === "string" ? body.name.trim() : "";
  if (rawName.length > MAX_NAME_CHARS) return badRequest('"name" is too long.', 413);

  const entry = await store().addPrediction(id, { name: rawName || "Anonymous", prediction });
  if (!entry) return badRequest("Unknown simulation.", 404);
  return Response.json({ prediction: entry }, { status: 201 });
}

/** Every prediction on a sim, oldest first, for the teacher's live list. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sims/[id]/predictions">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return badRequest("Unknown simulation.", 404);
  const sim = await store().getSim(id);
  if (!sim) return badRequest("Unknown simulation.", 404);
  return Response.json({ predictions: sim.predictions ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
