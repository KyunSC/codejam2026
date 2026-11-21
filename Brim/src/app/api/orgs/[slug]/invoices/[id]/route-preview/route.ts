import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json } from "@/lib/http";
import { routePreview } from "@/lib/workflow/approvals";
import type { IdCtx } from "@/lib/workflow/http";

/** GET /api/orgs/{slug}/invoices/{id}/route-preview: the approval chain and who could release (AP clerk and up). */
export async function GET(request: Request, { params }: IdCtx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const role = caller.user?.role;
    if (!role || role === "employee" || role === "approver") throw new AppError(403, "FORBIDDEN", "Your role can't preview routing.");
    return json(await db().$transaction((tx) => routePreview(tx, caller.org.id, id), { timeout: 60_000 }));
  });
}
