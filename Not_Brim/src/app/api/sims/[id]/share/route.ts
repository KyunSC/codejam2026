import { badRequest } from "@/lib/api";
import { validateHomework } from "@/lib/homework";
import { getModel } from "@/lib/model";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Make (once) the homework variation for a saved sim and return its student link. */
export async function POST(_req: Request, ctx: RouteContext<"/api/sims/[id]/share">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(id)) return badRequest("Unknown simulation.", 404);
  const sim = await store().getSharedSim(id);
  if (!sim) return badRequest("Unknown simulation.", 404);

  let homework = sim.homework;
  if (!homework) {
    try {
      const raw = await getModel().homework({ code: sim.code, params: sim.params, question: sim.question, title: sim.title });
      const checked = validateHomework(raw, sim.params);
      if (!checked.ok) return badRequest(`The homework didn't come out right (${checked.reason}). Try again.`, 502);
      homework = checked.homework;
      await store().updateSim(sim.id, { homework });
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : "Couldn't write the homework. Try again.", 502);
    }
  }
  return Response.json({ url: `/s/${id}`, homework }, { headers: { "Cache-Control": "no-store" } });
}
