import { badRequest } from "@/lib/api";
import { checkItems, type View } from "@/lib/board";
import { getModel } from "@/lib/model";
import { ndjsonResponse } from "@/lib/ndjson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 2000;

function readView(raw: unknown): View | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  const ok = [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok && (w as number) > 0 && (h as number) > 0 ? { x: x as number, y: y as number, w: w as number, h: h as number } : null;
}

/** "Ask Claude": the board goes in, Claude's actions stream out as NDJSON for the browser to apply. */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return badRequest("The board is too large to send.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const items = checkItems(body?.items);
  if (!items.ok) return badRequest(`Invalid board: ${items.reason}`);
  const message = typeof body.message === "string" ? body.message : "";
  if (message.length > MAX_MESSAGE_CHARS) return badRequest('"message" is too long.', 413);
  let image: string | null = null;
  if (body.image !== undefined && body.image !== null) {
    if (typeof body.image !== "string" || body.image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(body.image))
      return badRequest('"image" must be a base64 PNG.');
    image = body.image;
  }
  return ndjsonResponse(getModel().boardTurn({ items: items.value, view: readView(body.view), message, image }));
}
