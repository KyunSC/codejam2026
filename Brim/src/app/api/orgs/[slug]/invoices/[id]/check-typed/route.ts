import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json } from "@/lib/http";
import { OFFICES } from "@/lib/rules/offices";
import type { Province } from "@/lib/types";
import { requireAction } from "@/lib/workflow/guard";
import { checkStoredTypedInvoice } from "@/lib/workflow/manual";

/**
 * POST /api/orgs/{slug}/invoices/{id}/check-typed  { deliveredTo?: "ON" | "BC" | "AB" | "QC" }
 * Runs the checks on a typed invoice saved before typed invoices were checked (AP clerk, matrix
 * `invoice.edit`). 409 INVALID_STATE once it has left `received`; 409 NOT_TYPED for a file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.edit");
    const body = (await request.json().catch(() => ({}))) as { deliveredTo?: unknown };
    const deliveredTo = typeof body.deliveredTo === "string" && body.deliveredTo ? body.deliveredTo : null;
    if (deliveredTo && !OFFICES.some((o) => o.province === deliveredTo)) {
      throw new AppError(422, "BAD_FIELD", "deliveredTo: must be one of Harborline's offices (ON, BC, AB, QC)");
    }
    const out = await db().$transaction(
      (tx) =>
        checkStoredTypedInvoice(tx, { organizationId: caller.org.id, invoiceId: id, actor: actor.audit, deliveredTo: deliveredTo as Province | null }),
      { timeout: 60_000, maxWait: 10_000 },
    );
    return json({ invoiceId: out.invoiceId, end: out.end });
  });
}
