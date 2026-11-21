/**
 * The AP inbox as it stands on 2026-11-02, minus the sealed drill: 44 emails and the 41 files
 * they carry. Emails are stored unlabelled and no draft invoice is created; ingesting the inbox
 * (intake) does that, so the demo can show it happen.
 *
 * Documents are stored by SHA-256 with `url = dataset:incoming_invoices/<name>`; the bytes also live in Document.content for the app’s download route. Sealed files are skipped by name and never read.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { type Dataset, datasetDir } from "../dataset";
import { partitionInbox, sealedFileNames } from "../pipeline/sealed";
import { timestamp } from "./convert";

type Tx = Prisma.TransactionClient | PrismaClient;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function datasetDocumentUrl(fileName: string): string {
  return `dataset:incoming_invoices/${fileName}`;
}

export interface InboxSeed {
  emails: Omit<Prisma.InboxEmailCreateManyInput, "organizationId">[];
  documents: Omit<Prisma.DocumentCreateManyInput, "organizationId">[];
  sealedEmailCount: number;
}

/**
 * Builds the rows. `readFile` is injectable so tests can check that no sealed name is read.
 */
export function inboxSeedRows(
  ds: Pick<Dataset, "emails">,
  sealed: ReadonlySet<string> = sealedFileNames(),
  readFile: (name: string) => Buffer = (name) => readFileSync(path.join(datasetDir(), "incoming_invoices", name)),
): InboxSeed {
  const { open, sealed: held } = partitionInbox(ds.emails, sealed);

  const emails: Omit<Prisma.InboxEmailCreateManyInput, "organizationId">[] = open.map((e) => ({
    sourceId: e.emailId,
    fromName: e.fromName,
    fromAddress: e.fromAddress,
    toAddress: e.toAddress,
    subject: e.subject,
    receivedAt: timestamp(e.receivedAt),
    body: e.body,
    attachmentNames: e.attachments,
    source: "inbox",
  }));

  const documents: Omit<Prisma.DocumentCreateManyInput, "organizationId">[] = [];
  const seen = new Set<string>();
  for (const name of open.flatMap((e) => e.attachments)) {
    if (sealed.has(name)) throw new Error(`Refusing to read sealed file ${name}`);
    const bytes = readFile(name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // The same bytes under two names are one document; intake links both to it.
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    documents.push({
      sha256,
      fileName: name,
      mimeType: MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream",
      content: Buffer.from(bytes),
      sizeBytes: bytes.length,
      url: datasetDocumentUrl(name),
    });
  }
  return { emails, documents, sealedEmailCount: held.length };
}

export async function seedInbox(tx: Tx, ds: Dataset, organizationId: string): Promise<Record<string, number>> {
  const rows = inboxSeedRows(ds);
  const emails = await tx.inboxEmail.findMany({ where: { organizationId }, select: { sourceId: true } });
  const documents = await tx.document.findMany({ where: { organizationId }, select: { sha256: true } });
  const knownEmails = new Set(emails.map((e) => e.sourceId));
  const knownHashes = new Set(documents.map((d) => d.sha256));
  return {
    inboxEmails: (
      await tx.inboxEmail.createMany({
        data: rows.emails.filter((e) => !knownEmails.has(e.sourceId!)).map((e) => ({ ...e, organizationId })),
      })
    ).count,
    documents: (
      await tx.document.createMany({
        data: rows.documents.filter((d) => !knownHashes.has(d.sha256)).map((d) => ({ ...d, organizationId })),
      })
    ).count,
    sealedEmailsSkipped: rows.sealedEmailCount,
  };
}
