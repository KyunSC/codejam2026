import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { resolveFlag } from "@/lib/workflow/review";

/**
 * POST /api/orgs/{slug}/invoices/{id}/flags/{flagId}/resolve { action: "override" | "confirm", reason }.
 * Who may resolve depends on the flag's class (403 FLAG_CLASS); 422 REASON_REQUIRED.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string; flagId: string }> }) {
  return handle(async () => {
    const { slug, id, flagId } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization to do this.");
    const body = await readJson(request);
    const flag = await db().$transaction(
      (tx) =>
        resolveFlag(tx, workflowActor(caller.user!), {
          organizationId: caller.org.id,
          invoiceId: id,
          flagId,
          action: String(body.action ?? ""),
          reason: typeof body.reason === "string" ? body.reason : null,
        }),
      { timeout: 60_000 },
    );
    return json({ flag });
  });
}
