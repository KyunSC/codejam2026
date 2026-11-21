import { badRequest } from "@/lib/api";
import { BOARD_ID, boardStore, type NewBoard } from "@/lib/boards";
import { storageErrorResponse } from "@/lib/db";
import { demoBoardItems, listDemoBoards } from "@/lib/demo-boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a board: empty, or a copy of a demo board (`{ demo: slug }`). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: unknown; demo?: unknown } | null;
  let init: NewBoard = {};
  if (typeof body?.demo === "string") {
    const demo = await demoBoardItems(body.demo).catch(() => null);
    if (!demo) return badRequest("Unknown demo board.", 404);
    init = demo;
  } else if (typeof body?.title === "string") init = { title: body.title };
  try {
    const board = await boardStore().createBoard(init);
    return Response.json({ id: board.id }, { status: 201 });
  } catch (err) {
    return storageErrorResponse(err);
  }
}

/** The boards page: summaries of the boards whose ids this browser remembers, and the demo boards. */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => BOARD_ID.test(id))
    .slice(0, 200);
  try {
    const [boards, demos] = await Promise.all([boardStore().listBoards(ids), listDemoBoards()]);
    return Response.json({ boards, demos }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storageErrorResponse(err);
  }
}
