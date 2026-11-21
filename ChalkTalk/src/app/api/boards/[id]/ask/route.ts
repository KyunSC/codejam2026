import { badRequest } from "@/lib/api";
import type { View } from "@/lib/board";
import { BOARD_ID, boardStore } from "@/lib/boards";
import { runBoardTool } from "@/lib/board-tools";
import { storageErrorResponse } from "@/lib/db";
import { getModel } from "@/lib/model";
import { ndjsonResponse } from "@/lib/ndjson";
import type { BoardEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 2000;

function readView(raw: unknown): View | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  const ok = [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok && (w as number) > 0 && (h as number) > 0 ? { x: x as number, y: y as number, w: w as number, h: h as number } : null;
}

/**
 * "Ask Claude": Claude reads the stored board (items, changelog) plus the picture the page drew, and acts
 * through the board tools. The stream carries Claude's steps and the board after each change.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/boards/[id]/ask">) {
  const { id } = await ctx.params;
  if (!BOARD_ID.test(id)) return badRequest("Unknown board.", 404);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return badRequest("The picture is too large to send.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (message.length > MAX_MESSAGE_CHARS) return badRequest('"message" is too long.', 413);
  let image: string | null = null;
  if (body.image !== undefined && body.image !== null) {
    if (typeof body.image !== "string" || body.image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(body.image))
      return badRequest('"image" must be a base64 PNG.');
    image = body.image;
  }
  let board;
  try {
    board = await boardStore().getBoard(id);
  } catch (err) {
    return storageErrorResponse(err);
  }
  if (!board) return badRequest("Unknown board.", 404);
  const view = readView(body.view);
  const start = board;

  async function* turn(): AsyncGenerator<BoardEvent> {
    // Tools run inside the model's turn; each change is queued here and sent right after that step.
    const changed: BoardEvent[] = [];
    const runTool = async (name: string, input: unknown) => {
      const r = await runBoardTool(id, name, input, view);
      if (r.board) changed.push({ type: "board", board: r.board });
      return r;
    };
    for await (const ev of getModel().boardTurn({ board: start, view, message, image, runTool })) {
      yield ev;
      while (changed.length) yield changed.shift()!;
    }
  }
  return ndjsonResponse(turn());
}
