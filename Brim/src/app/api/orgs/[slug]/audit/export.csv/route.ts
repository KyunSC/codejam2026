import { getCaller } from "@/lib/context";
import { handle } from "@/lib/http";
import { auditCsv } from "@/lib/workflow/audit-pack";

/**
 * GET /api/orgs/{slug}/audit/export.csv?…filters: the log as CSV (controller, auditor). Read-only by
 * construction: this route has no write path, and the role check runs on the server.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    const q = new URL(request.url).searchParams;
    const t = (k: string) => q.get(k)?.trim() || undefined;
    const csv = await auditCsv(caller.user, {
      invoiceId: t("invoiceId"),
      paymentId: t("paymentId"),
      vendorId: t("vendorId"),
      actorId: t("actorId"),
      action: t("action"),
      entityType: t("entityType"),
      q: t("q"),
      from: t("from") ? `${t("from")}T00:00:00` : undefined,
      to: t("to") ? `${t("to")}T23:59:59.999` : undefined,
    });
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${caller.org.slug}.csv"` },
    });
  });
}
