import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireAction } from "@/lib/workflow/guard";
import { processInvoice } from "@/lib/workflow/process";

/**
 * POST /api/orgs/{slug}/invoices/{id}/process: re-run resolution, checks and coding (AP clerk).
 * 409 INVALID_STATE outside extracted / needs_review / coded; 409 VERSION_CONFLICT when another
 * change landed first (BUILD_PLAN's ALREADY_PROCESSING case).
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.edit");
    const r = await db().$transaction(
      (tx) => processInvoice(tx, { organizationId: caller.org.id, invoiceId: id, actor: actor.audit }),
      { timeout: 60_000 },
    );
    return json({ invoiceId: r.invoiceId, status: r.status, version: r.version, flags: r.flags });
  });
}
