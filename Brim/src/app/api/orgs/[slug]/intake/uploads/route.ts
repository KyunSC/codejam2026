import { requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { handle, json, readFiles, readForm } from "@/lib/http";
import { ingestUpload } from "@/lib/intake/service";

/**
 * POST /api/orgs/{slug}/intake/uploads (multipart/form-data)
 * - files: one or more invoice files uploaded by an AP clerk
 * Stores a draft invoice for each file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, (r) => r === "ap_clerk", "upload invoices (employees submit them instead)");
    const { org, actor } = caller;
    const form = await readForm(request);
    return json(await ingestUpload(org.id, actor, { files: await readFiles(form) }), 201);
  });
}
