import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { submit } from "@/lib/workflow/approvals";
import { requireAction } from "@/lib/workflow/guard";
import { ifMatchOf, type IdCtx } from "@/lib/workflow/http";

/** POST /api/orgs/{slug}/invoices/{id}/submit (AP clerk): 422 OPEN_FLAGS, CODING_INCOMPLETE, STEP_UNRESOLVABLE. */
export async function POST(request: Request, { params }: IdCtx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.submit");
    return json(await db().$transaction((tx) => submit(tx, actor, caller.org.id, id, ifMatchOf(request)), { timeout: 60_000 }));
  });
}
