import { MAX_CODE_CHARS, readFields } from "@/lib/api";
import { getModel } from "@/lib/model";
import { ndjsonResponse } from "@/lib/ndjson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ERROR_CHARS = 2000;

export async function POST(req: Request) {
  const body = await readFields(req, { code: MAX_CODE_CHARS, error: MAX_ERROR_CHARS });
  if (!body.ok) return body.response;
  return ndjsonResponse(getModel().repair(body.values.code, body.values.error));
}
