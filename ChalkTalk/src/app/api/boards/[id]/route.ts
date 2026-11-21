import { badRequest } from "@/lib/api";
import { BOARD_ID, boardStore } from "@/lib/boards";
import { storageErrorResponse } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The board. With `?since=<version>`, an empty 204 when nothing changed since then (the page polls this). */
export async function GET(req: Request, ctx: RouteContext<"/api/boards/[id]">) {
  const { id } = await ctx.params;
  let board;
  try {
    board = BOARD_ID.test(id) ? await boardStore().getBoard(id) : null;
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!board) return badRequest("Unknown board.", 404);
  const since = new URL(req.url).searchParams.get("since");
  if (since !== null && since !== "" && Number.isFinite(Number(since)) && board.version <= Number(since))
    return new Response(null, { status: 204 });
  return Response.json(board, { headers: { "Cache-Control": "no-store" } });
}
