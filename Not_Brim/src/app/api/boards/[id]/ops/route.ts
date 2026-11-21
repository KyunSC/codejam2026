import { badRequest } from "@/lib/api";
import { appendLog, applyOps, checkItems, checkOps, MAX_TITLE_CHARS } from "@/lib/board";
import { BOARD_ID, boardStore } from "@/lib/boards";
import { logEntriesFor } from "@/lib/board-tools";
import { storageErrorResponse } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changes carry sim code and handwriting, so they get more room than other bodies. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The student's changes, as puts and deletes applied on top of the latest board, so changes Claude or an MCP
 * client made meanwhile survive. Returns the board after the change.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/boards/[id]/ops">) {
  const { id } = await ctx.params;
  if (!BOARD_ID.test(id)) return badRequest("Unknown board.", 404);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return badRequest("The change is too large to save.", 413);
  let body: { ops?: unknown; title?: unknown };
  try {
    body = JSON.parse(text) as { ops?: unknown; title?: unknown };
  } catch {
    return badRequest("Body must be JSON.");
  }
  const ops = checkOps(body?.ops ?? []);
  if (!ops.ok) return badRequest(`Invalid change: ${ops.reason}`);
  const title = typeof body.title === "string" ? body.title.slice(0, MAX_TITLE_CHARS) : undefined;
  let invalid: string | null = null;
  let board;
  try {
    board = await boardStore().change(id, (b) => {
      const items = applyOps(b.items, ops.value);
      const checked = checkItems(items);
      if (!checked.ok) {
        invalid = checked.reason;
        return null;
      }
      const entries = logEntriesFor(b.items, items, "student");
      if (title !== undefined && title.trim() && title.trim() !== b.title)
        entries.push({ at: new Date().toISOString(), author: "student", text: `The student renamed the board to ${JSON.stringify(title.trim())}.` });
      return { items, ...(title !== undefined ? { title } : {}), log: appendLog(b.log, entries) };
    });
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!board) return badRequest("Unknown board.", 404);
  if (invalid) return badRequest(`Invalid board: ${invalid}`);
  return Response.json(board, { headers: { "Cache-Control": "no-store" } });
}
