/**
 * Intake: the business logic behind the three ways an invoice enters an organization.
 *
 * - Inbox: an emails.json from the AP inbox plus the attachment files it names.
 * - Upload: files an AP clerk uploads directly.
 * - Submission: files an employee submits for their department, with an optional PO and note.
 *
 * Every arriving file is stored as a Document and gets one draft Invoice in status "received".
 * Each email and each draft is written to the audit log. Identical files reuse the organization’s existing draft. Each call is one transaction, so a failure
 * stores nothing.
 */
import { storeAndDraft, intakeEmail, labelFor } from "../pipeline/intake";
import { hasAnthropicKey } from "../pipeline/extract/key";
import { createLabeller } from "../pipeline/label";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor } from "@/lib/audit";
import { parseEmails } from "@/lib/dataset";
import { db } from "@/lib/db";

/** A file as received, independent of how it arrived (multipart upload, disk, test). */
export interface IncomingFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** What one intake call stored. */
export interface IntakeResult {
  invoiceIds: string[];
  emailIds: string[];
  /** Attachment names listed on an email but not among the uploaded files. */
  missingAttachments: string[];
  /** Uploaded files that no email lists. They are not stored. */
  unreferencedFiles: string[];
}

type Tx = Prisma.TransactionClient;

function emptyResult(): IntakeResult {
  return { invoiceIds: [], emailIds: [], missingAttachments: [], unreferencedFiles: [] };
}

/** Stores the file and its draft invoice, and logs "invoice.received". */
async function receive(
  tx: Tx,
  organizationId: string,
  actor: Actor,
  file: IncomingFile,
  invoice: Omit<Prisma.InvoiceUncheckedCreateInput, "organizationId" | "documentId">,
) {
  const out = await storeAndDraft(
    tx,
    file.name,
    file.bytes,
    { ...invoice, organizationId },
    actor,
    false,
    file.mimeType,
  );
  return out.invoiceId;
}

/** Inbox: store every email, and a document plus a draft invoice for each attachment that arrived. */
export async function ingestInbox(
  organizationId: string,
  actor: Actor,
  input: { emailsJson: string; files: IncomingFile[] },
): Promise<IntakeResult> {
  const emails = parseEmails(input.emailsJson);
  const filesByName = new Map(input.files.map((f) => [f.name, f]));
  const listed = new Set(emails.flatMap((e) => e.attachments));
  const result = emptyResult();
  result.unreferencedFiles = input.files.map((f) => f.name).filter((n) => !listed.has(n));

  const labeller = hasAnthropicKey() ? createLabeller() : null;
  const labels: Array<Awaited<ReturnType<typeof labelFor>>> = [];
  for (const email of emails) labels.push(labeller ? await labelFor(db(), email, labeller, organizationId) : null);
  await db().$transaction(
    async (tx) => {
      for (const [i, email] of emails.entries()) {
        const files = new Map(email.attachments.map((name) => [name, filesByName.get(name)?.bytes ?? null]));
        const outcome = await intakeEmail(tx, email, { organizationId, actor, files, label: labels[i] });
        result.emailIds.push(outcome.storedEmailId);
        for (const attachment of outcome.attachments) {
          if (attachment.status === "missing_file") result.missingAttachments.push(attachment.fileName);
          else result.invoiceIds.push(attachment.invoiceId);
        }
      }
    },
    { timeout: 60_000 },
  );
  return result;
}

/** Upload: a document plus a draft invoice for each file. */
export async function ingestUpload(
  organizationId: string,
  actor: Actor,
  input: { files: IncomingFile[] },
): Promise<IntakeResult> {
  const result = emptyResult();
  const createdById = actor.type === "user" ? actor.userId : null;
  await db().$transaction(
    async (tx) => {
      for (const file of input.files) {
        result.invoiceIds.push(await receive(tx, organizationId, actor, file, { source: "upload", createdById }));
      }
    },
    { timeout: 60_000 },
  );
  return result;
}

/** Submission: like an upload, plus who submitted it and the PO number and note they typed. */
export async function ingestSubmission(
  organizationId: string,
  actor: Actor,
  input: { files: IncomingFile[]; createdById: string; poNumber: string | null; note: string | null },
): Promise<IntakeResult> {
  const result = emptyResult();
  await db().$transaction(
    async (tx) => {
      for (const file of input.files) {
        const invoice = await receive(tx, organizationId, actor, file, {
          source: "submission",
          createdById: input.createdById,
          poNumber: input.poNumber,
          note: input.note,
        });
        result.invoiceIds.push(invoice);
      }
    },
    { timeout: 60_000 },
  );
  return result;
}
