import { badRequest } from "@/lib/api";
import { checkItems } from "@/lib/board";
import { BOARD_ID, boardStore } from "@/lib/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Board saves carry sim code and handwriting, so they get more room than other bodies. */
const MAX_BOARD_BYTES = 8 * 1024 * 1024;

export async function GET(_req: Request, ctx: RouteContext<"/api/boards/[id]">) {
  const { id } = await ctx.params;
  const board = BOARD_ID.test(id) ? await boardStore().getBoard(id) : null;
  if (!board) return badRequest("Unknown board.", 404);
  return Response.json(board, { headers: { "Cache-Control": "no-store" } });
}

/** Save the board's items. The browser holds the board; this only checks and stores it. */
export async function PUT(req: Request, ctx: RouteContext<"/api/boards/[id]">) {
  const { id } = await ctx.params;
  if (!BOARD_ID.test(id)) return badRequest("Unknown board.", 404);
  const text = await req.text();
  if (text.length > MAX_BOARD_BYTES) return badRequest("The board is too large to save.", 413);
  let body: { items?: unknown };
  try {
    body = JSON.parse(text) as { items?: unknown };
  } catch {
    return badRequest("Body must be JSON.");
  }
  const items = checkItems(body?.items);
  if (!items.ok) return badRequest(`Invalid board: ${items.reason}`);
  const board = await boardStore().saveItems(id, items.value);
  if (!board) return badRequest("Unknown board.", 404);
  return Response.json({ updatedAt: board.updatedAt });
}
