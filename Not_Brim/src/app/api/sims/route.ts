import { MAX_CODE_CHARS, MAX_PROMPT_CHARS, badRequest } from "@/lib/api";
import { validateParams } from "@/lib/bridge";
import { validateHtml } from "@/lib/sim-html";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 1000;

/** Save a sim that reached `ready`. Re-validates everything: the body comes from the browser. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const { prompt, code, title, question } = body ?? {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS * 2)
    return badRequest('"prompt" is required.');
  if (typeof code !== "string" || code.length > MAX_CODE_CHARS) return badRequest('"code" is required.');
  const html = validateHtml(code);
  if (!html.ok) return badRequest(`Invalid sim: ${html.reason}`);
  if (typeof title !== "string" || title.length > MAX_TEXT) return badRequest('"title" is required.');
  if (typeof question !== "string" || question.length > MAX_TEXT) return badRequest('"question" is required.');
  const params = validateParams(body.params);
  if (!params.ok) return badRequest(`Invalid params: ${params.reason}`);

  const record = await store().saveSim({ prompt: prompt.trim(), code, title, question, params: params.params });
  return Response.json({ id: record.id }, { status: 201 });
}

export async function GET() {
  return Response.json({ sims: await store().listSims() }, { headers: { "Cache-Control": "no-store" } });
}
