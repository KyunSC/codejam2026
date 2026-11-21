import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { reopen } from "@/lib/workflow/approvals";
import { requireAction } from "@/lib/workflow/guard";
import type { IdCtx } from "@/lib/workflow/http";

/** POST /api/orgs/{slug}/invoices/{id}/reopen { reason } (AP clerk): a rejected invoice back to review. */
export async function POST(request: Request, { params }: IdCtx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.edit");
    const body = await readJson(request);
    const reason = typeof body.reason === "string" ? body.reason : null;
    return json(await db().$transaction((tx) => reopen(tx, actor, caller.org.id, id, reason)));
  });
}
