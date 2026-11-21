import { boardStore } from "@/lib/boards";
import { storageErrorResponse } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a new, empty board. */
export async function POST() {
  try {
    const board = await boardStore().createBoard();
    return Response.json({ id: board.id }, { status: 201 });
  } catch (err) {
    return storageErrorResponse(err);
  }
}
