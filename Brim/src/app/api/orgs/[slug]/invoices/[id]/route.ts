import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";
import { getInvoiceFor } from "@/lib/invoices/service";

/** GET /api/orgs/{slug}/invoices/{id}: the invoice, its file details, email, lines and history. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    return json(await getInvoiceFor(caller.org.id, caller.user, id));
  });
}
