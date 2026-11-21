/** Small request helpers shared by the workflow routes. */
export function ifMatchOf(request: Request, body?: Record<string, unknown>): number | null {
  const header = request.headers.get("if-match")?.replace(/"/g, "").trim();
  if (header && /^\d+$/.test(header)) return Number(header);
  const v = body?.version;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export type IdCtx = { params: Promise<{ slug: string; id: string }> };
