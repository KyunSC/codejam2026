import { boardStore } from "@/lib/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a new, empty board. */
export async function POST() {
  const board = await boardStore().createBoard();
  return Response.json({ id: board.id }, { status: 201 });
}
