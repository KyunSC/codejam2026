import { requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { AppError, handle, json, readFiles, readForm, readText } from "@/lib/http";
import { ingestSubmission } from "@/lib/intake/service";

/**
 * POST /api/orgs/{slug}/intake/submissions (multipart/form-data), sent by the submitting employee
 * - files:    one or more invoice files
 * - poNumber: optional PO number
 * - note:     optional note
 * Stores a draft invoice for each file, with the caller as submitter.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    const { org, actor, user } = caller;
    if (!user) throw new AppError(422, "SUBMITTER_REQUIRED", "A submission is sent by a logged-in employee.");
    requirePermission(caller, (r) => r === "employee", "submit invoices (AP clerks upload them instead)");
    const form = await readForm(request);
    const result = await ingestSubmission(org.id, actor, {
      files: await readFiles(form),
      createdById: user.id,
      poNumber: readText(form, "poNumber"),
      note: readText(form, "note"),
    });
    return json(result, 201);
  });
}
