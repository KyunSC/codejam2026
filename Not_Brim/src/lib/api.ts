import "server-only";

export const MAX_PROMPT_CHARS = 2000;
export const MAX_CODE_CHARS = 160 * 1024;

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** Read a JSON body and pull out the named string fields, trimmed and size-checked. */
export async function readFields<K extends string>(
  req: Request,
  fields: Record<K, number>,
): Promise<{ ok: true; values: Record<K, string> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: badRequest("Body must be JSON.") };
  }
  const values = {} as Record<K, string>;
  for (const [key, max] of Object.entries(fields) as Array<[K, number]>) {
    const v = (body as Record<string, unknown> | null)?.[key];
    if (typeof v !== "string" || !v.trim()) return { ok: false, response: badRequest(`"${key}" is required.`) };
    if (v.length > max) return { ok: false, response: badRequest(`"${key}" is too long.`, 413) };
    values[key] = v.trim();
  }
  return { ok: true, values };
}
