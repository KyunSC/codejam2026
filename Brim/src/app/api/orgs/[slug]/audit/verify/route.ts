import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";
import { verifyAuditChain } from "@/lib/workflow/audit-pack";

/** GET /api/orgs/{slug}/audit/verify: recompute the hash chain; the first row that does not match (controller, auditor). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    return json(await verifyAuditChain(caller.user));
  });
}
