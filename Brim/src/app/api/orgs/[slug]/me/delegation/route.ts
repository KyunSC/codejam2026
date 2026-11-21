import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { setDelegation } from "@/lib/workflow/approvals";
import { requireAction } from "@/lib/workflow/guard";

/** PUT /api/orgs/{slug}/me/delegation { delegateId: "U003" | null, onLeave: boolean }: 422 DELEGATE_INVALID. */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "delegate.set_own");
    const body = await readJson(request);
    const delegateId = typeof body.delegateId === "string" && body.delegateId ? body.delegateId : null;
    const u = await db().$transaction((tx) => setDelegation(tx, actor, { delegateId, onLeave: body.onLeave === true }));
    return json({ delegateId: u.delegateId, status: u.status });
  });
}
