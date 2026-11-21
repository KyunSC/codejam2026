import { MAX_PROMPT_CHARS, readFields } from "@/lib/api";
import { getModel } from "@/lib/model";
import { ndjsonResponse } from "@/lib/ndjson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readFields(req, { prompt: MAX_PROMPT_CHARS });
  if (!body.ok) return body.response;
  return ndjsonResponse(getModel().generate(body.values.prompt));
}
