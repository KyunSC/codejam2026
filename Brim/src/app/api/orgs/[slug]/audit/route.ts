import { type Actor, listActions } from "@/lib/audit";
import { canViewAudit, requirePermission } from "@/lib/auth/permissions";
import { findUser, getCaller } from "@/lib/context";
import { AppError, handle, json } from "@/lib/http";

const ACTOR_TYPES: Actor["type"][] = ["user", "llm", "system", "brim_admin"];

/**
 * GET /api/orgs/{slug}/audit: the organization's audit log, newest first.
 * Query filters, all optional: q (free text), invoiceId, actorId, actorType, action, entityType, entityId,
 * from, to (ISO timestamps), limit (default 100, max 1000), beforeSeq (next page).
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, canViewAudit, "see the audit log");
    const { org } = caller;
    const q = new URL(request.url).searchParams;
    const text = (k: string) => q.get(k)?.trim() || undefined;

    const actorType = text("actorType") as Actor["type"] | undefined;
    if (actorType && !ACTOR_TYPES.includes(actorType)) {
      throw new AppError(400, "BAD_FILTER", `actorType must be one of ${ACTOR_TYPES.join(", ")}`);
    }
    for (const k of ["from", "to"]) {
      const v = text(k);
      if (v && Number.isNaN(Date.parse(v))) throw new AppError(400, "BAD_FILTER", `${k} must be an ISO timestamp`);
    }
    const limit = text("limit");
    if (limit && !/^\d+$/.test(limit)) throw new AppError(400, "BAD_FILTER", "limit must be a whole number");
    const beforeSeq = text("beforeSeq");
    if (beforeSeq && !/^\d+$/.test(beforeSeq)) throw new AppError(400, "BAD_FILTER", "beforeSeq must be a whole number");

    // actorId may be the organization's own id for a person (e.g. "U001"); the log stores User.id.
    const actorIdParam = text("actorId");
    const actorId = actorIdParam ? ((await findUser(org.id, actorIdParam))?.id ?? actorIdParam) : undefined;

    return json(
      await listActions(org.id, {
        invoiceId: text("invoiceId"),
        actorId,
        actorType,
        action: text("action"),
        entityType: text("entityType"),
        entityId: text("entityId"),
        q: text("q"),
        from: text("from"),
        to: text("to"),
        limit: limit ? Number(limit) : undefined,
        beforeSeq: beforeSeq ? BigInt(beforeSeq) : undefined,
      }),
    );
  });
}
