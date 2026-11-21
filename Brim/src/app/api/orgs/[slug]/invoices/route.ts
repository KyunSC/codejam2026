import { canCreateInvoices, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { AppError, handle, json, readJson } from "@/lib/http";
import { createManualInvoice, listInvoicesFor } from "@/lib/invoices/service";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/orgs/{slug}/invoices?scope=mine|all&q=&status=&source=: the caller's invoices. */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    if (!caller.user) throw new AppError(422, "USER_REQUIRED", "Log in as a user of this organization.");
    const q = new URL(request.url).searchParams;
    return json(
      await listInvoicesFor(caller.user, {
        scope: q.get("scope") ?? undefined,
        q: q.get("q") ?? undefined,
        status: q.get("status") ?? undefined,
        source: q.get("source") ?? undefined,
      }),
    );
  });
}

/**
 * POST /api/orgs/{slug}/invoices: an invoice typed into the form (no file).
 * Body: { vendorName, invoiceNumber, total, invoiceDate?, dueDate?, currency?, subtotal?,
 *         gstHstAmount?, pstQstAmount?, poNumber?, note?, lines?: [{ description, quantity?, unitPrice?, amount? }] }
 */
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, canCreateInvoices, "create invoices");
    return json(await createManualInvoice(caller.org.id, caller.actor, await readJson(request)), 201);
  });
}
