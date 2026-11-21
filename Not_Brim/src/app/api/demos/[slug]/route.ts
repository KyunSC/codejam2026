import { badRequest } from "@/lib/api";
import { storageErrorResponse } from "@/lib/db";
import { demos } from "@/lib/demos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/demos/[slug]">) {
  const { slug } = await ctx.params;
  let demo;
  try {
    demo = await demos().getDemo(slug);
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!demo) return badRequest("Unknown demo.", 404);
  return Response.json(demo, { headers: { "Cache-Control": "no-store" } });
}
