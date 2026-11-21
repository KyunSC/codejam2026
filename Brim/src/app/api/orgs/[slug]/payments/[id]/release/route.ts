import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireAction } from "@/lib/workflow/guard";
import { releasePayment } from "@/lib/workflow/payments";

/** POST /api/orgs/{slug}/payments/{id}/release: 403 APPROVER_CANNOT_RELEASE, RELEASE_LIMIT; 422 OPEN_HOLD …. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "payment.release");
    return json(await db().$transaction((tx) => releasePayment(tx, actor, caller.org.id, id), { timeout: 60_000 }));
  });
}
