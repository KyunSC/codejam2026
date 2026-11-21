import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { getInvoiceFor } from "@/lib/invoices/service";
import { requireAction } from "@/lib/workflow/guard";
import { type InvoicePatch, patchInvoice } from "@/lib/workflow/review";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** GET /api/orgs/{slug}/invoices/{id}: the invoice, its file details, email, lines and history. */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    return json(await getInvoiceFor(caller.org.id, caller.user, id));
  });
}

/**
 * PATCH /api/orgs/{slug}/invoices/{id} with If-Match: <version> (AP clerk).
 * Body: { fields?, choices?, lines?: [{ lineNo, accept? | glFinal?, departmentFinal? }] }.
 * 409 VERSION_CONFLICT, 409 INVALID_STATE, 428 VERSION_REQUIRED.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "invoice.edit");
    const header = request.headers.get("if-match")?.replace(/"/g, "").trim();
    const ifMatch = header && /^\d+$/.test(header) ? Number(header) : null;
    const body = (await readJson(request)) as InvoicePatch;
    if (body.lines !== undefined && !Array.isArray(body.lines)) throw new AppError(422, "BAD_FIELD", "lines: must be a list.");
    const r = await db().$transaction((tx) => patchInvoice(tx, actor, caller.org.id, id, ifMatch, body), { timeout: 60_000 });
    return json(r);
  });
}
