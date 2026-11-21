/**
 * The AP inbox as it stands on 2026-11-02, minus the sealed drill: 44 emails and the 41 files
 * they carry. Emails are stored unlabelled and no draft invoice is created; ingesting the inbox
 * (intake) does that, so the demo can show it happen.
 *
 * Documents are stored by SHA-256 with `url = dataset:incoming_invoices/<name>`; the bytes stay
 * in the dataset folder. Sealed files are skipped by name and never read.
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
  emails: Prisma.InboxEmailCreateManyInput[];
  documents: Prisma.DocumentCreateManyInput[];
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

  const emails: Prisma.InboxEmailCreateManyInput[] = open.map((e) => ({
    id: e.emailId,
    fromName: e.fromName,
    fromAddress: e.fromAddress,
    toAddress: e.toAddress,
    subject: e.subject,
    receivedAt: timestamp(e.receivedAt),
    body: e.body,
    attachments: e.attachments,
    source: "inbox",
  }));

  const documents: Prisma.DocumentCreateManyInput[] = [];
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
      mime: MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream",
      bytes: bytes.length,
      url: datasetDocumentUrl(name),
    });
  }
  return { emails, documents, sealedEmailCount: held.length };
}

export async function seedInbox(tx: Tx, ds: Dataset): Promise<Record<string, number>> {
  const rows = inboxSeedRows(ds);
  return {
    inboxEmails: (await tx.inboxEmail.createMany({ data: rows.emails })).count,
    documents: (await tx.document.createMany({ data: rows.documents })).count,
    sealedEmailsSkipped: rows.sealedEmailCount,
  };
}
