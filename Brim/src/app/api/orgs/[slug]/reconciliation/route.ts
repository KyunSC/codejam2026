import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";
import { reconciliation } from "@/lib/workflow/reconciliation";

/** GET /api/orgs/{slug}/reconciliation: the statement matched to payments, and what is left (finance manager, controller, auditor). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    return json(await reconciliation(caller.user));
  });
}
