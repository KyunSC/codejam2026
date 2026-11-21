/**
 * Intake: the business logic behind the three ways an invoice enters an organization.
 *
 * - Inbox: an emails.json from the AP inbox plus the attachment files it names.
 * - Upload: files an AP clerk uploads directly.
 * - Submission: files an employee submits for their department, with an optional PO and note.
 *
 * Every arriving file is stored as a Document and gets one draft Invoice in status "received".
 * Each email and each draft is written to the audit log. Nothing is checked or skipped yet:
 * no duplicate, file-type or email-type handling. Each call is one transaction, so a failure
 * stores nothing.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor, logAction } from "@/lib/audit";
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
  const doc = await tx.document.create({
    data: {
      organizationId,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      fileName: file.name,
      mimeType: file.mimeType || "application/octet-stream",
      sizeBytes: file.bytes.byteLength,
      content: Buffer.from(file.bytes),
    },
  });
  const created = await tx.invoice.create({ data: { ...invoice, organizationId, documentId: doc.id } });
  await logAction(tx, {
    organizationId,
    actor,
    action: "invoice.received",
    entityType: "invoice",
    entityId: created.id,
    after: { ...created, fileName: doc.fileName, sha256: doc.sha256, sizeBytes: doc.sizeBytes },
  });
  return created;
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

  await db().$transaction(
    async (tx) => {
      for (const e of emails) {
        const email = await tx.inboxEmail.create({
          data: {
            organizationId,
            sourceId: e.emailId,
            fromName: e.fromName,
            fromAddress: e.fromAddress,
            toAddress: e.toAddress,
            subject: e.subject,
            body: e.body,
            receivedAt: new Date(e.receivedAt),
            attachmentNames: e.attachments,
          },
        });
        await logAction(tx, { organizationId, actor, action: "email.received", entityType: "email", entityId: email.id, after: email });
        result.emailIds.push(email.id);

        for (const name of e.attachments) {
          const file = filesByName.get(name);
          if (!file) {
            result.missingAttachments.push(name);
            continue;
          }
          const invoice = await receive(tx, organizationId, actor, file, { source: "inbox", emailId: email.id });
          result.invoiceIds.push(invoice.id);
        }
      }
    },
    { timeout: 60_000 },
  );
  return result;
}

/** Upload: a document plus a draft invoice for each file. */
export async function ingestUpload(organizationId: string, actor: Actor, input: { files: IncomingFile[] }): Promise<IntakeResult> {
  const result = emptyResult();
  const createdById = actor.type === "user" ? actor.userId : null;
  await db().$transaction(
    async (tx) => {
      for (const file of input.files) {
        result.invoiceIds.push((await receive(tx, organizationId, actor, file, { source: "upload", createdById })).id);
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
        result.invoiceIds.push(invoice.id);
      }
    },
    { timeout: 60_000 },
  );
  return result;
}
