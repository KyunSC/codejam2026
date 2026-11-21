import { canIngestInbox, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { AppError, handle, json, readFiles, readForm } from "@/lib/http";
import { ingestInbox } from "@/lib/intake/service";

/**
 * POST /api/orgs/{slug}/intake/inbox (multipart/form-data)
 * - emails: the AP inbox export, emails.json (as a file or as text)
 * - files:  the attachment files it names (repeat the field for each file)
 * Stores every email, and a draft invoice for each attachment that arrived.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, canIngestInbox, "read the AP inbox");
    const { org, actor } = caller;
    const form = await readForm(request);
    const emails = form.get("emails");
    if (emails === null) throw new AppError(400, "NO_EMAILS", 'Attach emails.json under "emails".');
    const emailsJson = typeof emails === "string" ? emails : await emails.text();
    const files = await readFiles(form, false);
    try {
      return json(await ingestInbox(org.id, actor, { emailsJson, files }), 201);
    } catch (err) {
      if (err instanceof SyntaxError || (err instanceof Error && err.message.startsWith("emails.json"))) {
        throw new AppError(400, "BAD_INBOX_FILE", err.message);
      }
      throw err;
    }
  });
}
