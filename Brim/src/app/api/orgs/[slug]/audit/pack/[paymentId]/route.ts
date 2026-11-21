import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";
import { auditPack } from "@/lib/workflow/audit-pack";

/** GET /api/orgs/{slug}/audit/pack/{paymentId}: everything about one payment on one page (controller, auditor). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; paymentId: string }> }) {
  return handle(async () => {
    const { slug, paymentId } = await params;
    const caller = await getCaller(request, slug);
    return json(await auditPack(caller.user, paymentId));
  });
}
