import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { decide } from "@/lib/workflow/approvals";
import { requireAction } from "@/lib/workflow/guard";
import { ifMatchOf, type IdCtx } from "@/lib/workflow/http";

/** POST /api/orgs/{slug}/invoices/{id}/approve { comment, version? } (the step's assignee): 403 NOT_YOUR_STEP, SELF_APPROVAL; 409 VERSION_CONFLICT. */
export async function POST(request: Request, { params }: IdCtx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.decide");
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const comment = typeof body.comment === "string" ? body.comment : null;
    return json(
      await db().$transaction(
        (tx) => decide(tx, actor, { organizationId: caller.org.id, invoiceId: id, decision: "approve", comment, ifMatch: ifMatchOf(request, body) }),
        { timeout: 60_000 },
      ),
    );
  });
}
