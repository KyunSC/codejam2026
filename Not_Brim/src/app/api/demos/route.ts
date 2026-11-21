import { badRequest, MAX_CODE_CHARS } from "@/lib/api";
import { storageErrorResponse } from "@/lib/db";
import { checkDemo, demos, slugify } from "@/lib/demos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ demos: await demos().listDemos() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storageErrorResponse(err);
  }
}

/** "Save as demo": writes data/demos/<slug>.json. The slug defaults to the title. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Body must be JSON.");
  }
  if (typeof body?.code === "string" && body.code.length > MAX_CODE_CHARS) return badRequest('"code" is too long.', 413);
  const slug = typeof body.slug === "string" && body.slug ? body.slug : slugify(String(body.title ?? ""));
  const checked = checkDemo({ ...body, slug, handMade: false, savedAt: new Date().toISOString() });
  if (!checked.ok) return badRequest(`Invalid demo: ${checked.reason}`);
  try {
    await demos().saveDemo(checked.demo);
  } catch (err) {
    return storageErrorResponse(err);
  }
  return Response.json({ slug }, { status: 201 });
}
