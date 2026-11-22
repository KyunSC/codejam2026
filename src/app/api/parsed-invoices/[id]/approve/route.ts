import { handler } from "@/lib/api";
import { approve } from "@/services/parsedInvoiceReview.service";

export const POST = handler<RouteContext<"/api/parsed-invoices/[id]/approve">>(async (req, user, ctx) => {
  const body = await req.json().catch(() => ({}));
  return { invoice_id: await approve(user, (await ctx.params).id, body.history) };
});
