/**
 * Shared by every API route: one error type, one error response shape, and request readers.
 * Errors follow BUILD_PLAN: { "error": { "code", "message" } }.
 */
import type { IncomingFile } from "./intake/service";

/** An expected failure with an HTTP status and a stable code. Anything else is a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error("[api] failed", err);
  return Response.json({ error: { code: "INTERNAL", message: "Something failed; nothing was stored." } }, { status: 500 });
}

/** Runs a route body and turns any thrown error into an error response. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

/** JSON with BigInt (audit seq) written as a string. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AppError(400, "BAD_JSON", "Send a JSON object as the request body.");
}

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new AppError(400, "NOT_MULTIPART", "Send the request as multipart/form-data.");
  }
}

/** Every File under the "files" field. At least one is required unless `required` is false. */
export async function readFiles(form: FormData, required = true): Promise<IncomingFile[]> {
  const files = form.getAll("files").filter((v): v is File => typeof v !== "string");
  if (required && files.length === 0) throw new AppError(400, "NO_FILES", 'Attach at least one file under "files".');
  return Promise.all(
    files.map(async (f) => ({ name: f.name, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

/** A form text field, trimmed; null when absent or blank. */
export function readText(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
