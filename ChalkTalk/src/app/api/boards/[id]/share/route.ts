import { badRequest } from "@/lib/api";
import { BOARD_ID, boardStore } from "@/lib/boards";
import { storageErrorResponse } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The board's student link. Made once; opening it gives each student their own copy of the board. */
export async function POST(_req: Request, ctx: RouteContext<"/api/boards/[id]/share">) {
  const { id } = await ctx.params;
  if (!BOARD_ID.test(id)) return badRequest("Unknown board.", 404);
  let board;
  try {
    board = await boardStore().share(id);
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!board?.shareToken) return badRequest("Unknown board.", 404);
  return Response.json({ url: `/s/${board.shareToken}` }, { headers: { "Cache-Control": "no-store" } });
}
