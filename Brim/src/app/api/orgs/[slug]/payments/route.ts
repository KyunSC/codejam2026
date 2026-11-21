import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { requireAction } from "@/lib/workflow/guard";
import { paymentsDashboard } from "@/lib/workflow/payment-queries";
import { preparePayment } from "@/lib/workflow/payments";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/orgs/{slug}/payments?bucket=: the dashboard (AP clerk and up, auditor). */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const role = caller.user?.role;
    if (!role || role === "employee" || role === "approver") throw new AppError(403, "FORBIDDEN", "Your role can't see payments.");
    const bucket = new URL(request.url).searchParams.get("bucket");
    return json(await paymentsDashboard(caller.org.id, bucket));
  });
}

/** POST /api/orgs/{slug}/payments { invoiceId, scheduledDate? } (AP clerk). */
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "payment.prepare");
    const body = await readJson(request);
    if (typeof body.invoiceId !== "string") throw new AppError(422, "BAD_FIELD", "invoiceId: required.");
    const scheduledDate = typeof body.scheduledDate === "string" ? body.scheduledDate : null;
    return json(await db().$transaction((tx) => preparePayment(tx, actor, caller.org.id, body.invoiceId as string, scheduledDate)), 201);
  });
}
