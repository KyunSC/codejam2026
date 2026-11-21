import { getCaller } from "@/lib/context";
import { handle } from "@/lib/http";
import { getDocumentFor } from "@/lib/invoices/service";

/** GET /api/orgs/{slug}/documents/{id}: the stored file, shown inline (PDF or image). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const doc = await getDocumentFor(caller.org.id, caller.user, id);
    return new Response(new Uint8Array(doc.content), {
      headers: {
        "content-type": doc.mimeType,
        "content-disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
