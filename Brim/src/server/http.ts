import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE, userFromSession } from "@/lib/auth";
import { assertCan, authorize, type Action } from "@/lib/authz";
import { AppError, ForbiddenError, UnauthorizedError } from "@/lib/errors";
import type { Paging } from "@/lib/paging";
import type { User } from "@/lib/types";

export type Args = { req: Request; res: Response; user: User | null; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> };

// The role a route requires before the service runs. Under /organizations/:orgId it is checked for that organization;
// `brim` names the action a Brim employee needs instead, for setup routes they may use.
export type Gate = { gate?: Action; brim?: Action };

function checkGate(user: User | null, params: Record<string, string>, g: Gate) {
  if (!g.gate) return;
  if (!user) throw new UnauthorizedError("Sign in");
  const action = user.role === "brim_employee" ? g.brim : g.gate;
  if (!action) throw new ForbiddenError(`Not allowed: ${g.gate}`);
  if (params.orgId) authorize(user, params.orgId, action);
  else assertCan(user, action);
}

// Route handler wrapper: the signed-in user, the path parameters, the role gate, and the result sent as JSON.
// A POST that creates something answers 201 with its id.
export function route(fn: (a: Args) => Promise<unknown>, g: Gate = {}): RequestHandler {
  return async (req, res) => {
    const user = await userFromSession(req.cookies?.[SESSION_COOKIE]);
    const params = req.params as Record<string, string>;
    checkGate(user, params, g);
    const query = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
    const out = await fn({ req, res, user, params, query, body: (req.body ?? {}) as Record<string, unknown> });
    if (res.headersSent) return;
    const created = req.method === "POST" && out !== null && typeof out === "object" && "id" in out;
    res.status(created ? 201 : 200).json(out ?? { ok: true });
  };
}

// Errors become their HTTP status with { error }. Intentional 4xx errors (the services' AppErrors, and
// Express/multer request errors such as a bad JSON body or an oversized upload) keep their message;
// anything else is logged here and answered with a generic 500, so database and library details stay server-side.
export const errors: ErrorRequestHandler = (e, _req, res, _next) => {
  if (e?.type === "entity.parse.failed") return void res.status(400).json({ error: "Send a JSON body" });
  const status = e instanceof AppError ? e.status : e?.name === "MulterError" ? 400 : Number(e?.status ?? e?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) return void res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
  console.error(e);
  res.status(500).json({ error: "Something went wrong. Try again, or check the server log." });
};

export const param = (q: URLSearchParams, k: string) => q.get(k) || undefined;

// ?page= and ?size= as paging for the services.
export function pagingOf(q: URLSearchParams): Paging {
  const n = (k: string) => (Number.isInteger(Number(q.get(k))) && Number(q.get(k)) > 0 ? Number(q.get(k)) : undefined);
  return { page: n("page"), size: n("size") };
}
