/**
 * Intake (BUILD_PLAN "Intake"): store each file by SHA-256, one draft invoice per attachment,
 * label the emails that carry no attachment.
 *
 * - A file is a `Document`, unique by SHA-256. The same bytes arriving again (in another email,
 *   another upload, or the same email ingested twice) create no second draft: the arrival is
 *   reported as `already_received`, pointing at the first draft.
 * - A draft is an `Invoice` with status `received`, its document and email, and the date it
 *   arrived. Extraction and normalisation fill it in later (run.ts).
 * - Emails with attachments are left unlabelled here: they are labelled by what the
 *   attachment turns out to be. Emails without one get the labeller's answer; a payment
 *   inquiry is linked to the invoice it asks about, a statement to its vendor, both found
 *   through the sender's address.
 * - Two entry points: `intakeEmail` (an email and its files, from the inbox or an uploaded
 *   `emails.json`) and `intakeFile` (a loose upload).
 *
 * Writes go through the transaction client the caller passes, so a whole email lands or none
 * of it does. The labeller is called before the transaction (`labelFor`), never inside one.
 *
 * Sealed files are not this module's concern: whoever reads the files (the ingest script)
 * keeps them out.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EmailRow } from "../dataset";
import { dateOnly, timestamp } from "../seed/convert";
import { today } from "../today";
import type { IsoDate } from "../types";
import { matchKey } from "./evidence";
import { sniffMime } from "./inspect";
import { createHash } from "node:crypto";
import { needsLabel, type EmailLabeller, type LabelResult } from "./label";
import { invoiceNumberKeys } from "./normalize/invoice-number";
import { transactionsOn, type Db, type InTransaction } from "./tx";

type Tx = Db;

/** An email as `emails.json` gives it. */
export type IntakeEmail = EmailRow;

export type AttachmentOutcome =
  | { fileName: string; status: "draft"; sha256: string; documentId: string; invoiceId: string; newDocument: boolean }
  | { fileName: string; status: "already_received"; sha256: string; documentId: string; invoiceId: string }
  | { fileName: string; status: "missing_file" };

export interface EmailOutcome {
  emailId: string;
  newEmail: boolean;
  attachments: AttachmentOutcome[];
  /** Set for an email without attachments. */
  label: {
    label: string | null;
    reason: string;
    source: "model" | "recorded" | null;
    linkedInvoiceId: string | null;
    linkedVendorId: string | null;
  } | null;
}

/** Serialises invoice id allocation across concurrent intakes (any constant works). */
const INVOICE_ID_LOCK = 4_202_611;

/** Next free `AP-nnnnn` ids. Takes a transaction-scoped lock so two intakes cannot collide. */
export async function allocateInvoiceIds(tx: Tx, count: number): Promise<string[]> {
  if (count === 0) return [];
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(${INVOICE_ID_LOCK})) AS l`;
  const [{ m }] = await tx.$queryRaw<
    Array<{ m: number | null }>
  >`SELECT max(substring(id from 4)::int) AS m FROM "Invoice" WHERE id ~ '^AP-[0-9]+$'`;
  const start = (m ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => `AP-${String(start + i).padStart(5, "0")}`);
}

/** The date part of an email's timestamp, as written (the dataset's times carry no zone). */
export function receivedDateOf(receivedAt: string): IsoDate {
  return receivedAt.slice(0, 10);
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Stores the file (or finds it) and creates its draft unless the same bytes already have one.
 */
async function storeAndDraft(
  tx: Tx,
  fileName: string,
  bytes: Uint8Array,
  draft: Omit<Prisma.InvoiceUncheckedCreateInput, "id" | "status" | "documentId">,
): Promise<AttachmentOutcome> {
  const sha256 = sha256Of(bytes);
  let doc = await tx.document.findUnique({ where: { sha256 }, select: { id: true } });
  const newDocument = doc === null;
  if (!doc) {
    doc = await tx.document.create({
      data: {
        sha256,
        fileName,
        mime: sniffMime(bytes) ?? "application/octet-stream",
        bytes: bytes.length,
        data: Buffer.from(bytes),
      },
      select: { id: true },
    });
  }
  const first = await tx.invoice.findFirst({
    where: { documentId: doc.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (first) return { fileName, status: "already_received", sha256, documentId: doc.id, invoiceId: first.id };
  const [invoiceId] = await allocateInvoiceIds(tx, 1);
  await tx.invoice.create({ data: { ...draft, id: invoiceId, status: "received", documentId: doc.id } });
  return { fileName, status: "draft", sha256, documentId: doc.id, invoiceId, newDocument };
}

/** Vendors the email could be from: same contact address; when several share it, the one whose
 * legal name the sender's display name contains, if exactly one does. */
async function senderVendors(tx: Tx, email: IntakeEmail): Promise<Array<{ id: string; legalName: string }>> {
  const byAddress = await tx.vendor.findMany({
    where: { apContactEmail: { equals: email.fromAddress.trim(), mode: "insensitive" } },
    select: { id: true, legalName: true },
    orderBy: { id: "asc" },
  });
  if (byAddress.length <= 1) return byAddress;
  const named = byAddress.filter((v) => matchKey(email.fromName).includes(matchKey(v.legalName)));
  return named.length === 1 ? named : byAddress;
}

async function links(
  tx: Tx,
  email: IntakeEmail,
  label: Extract<LabelResult, { ok: true }>,
): Promise<{ linkedInvoiceId: string | null; linkedVendorId: string | null }> {
  if (label.label !== "payment_inquiry" && label.label !== "statement") {
    return { linkedInvoiceId: null, linkedVendorId: null };
  }
  const vendors = await senderVendors(tx, email);
  const vendorId = vendors.length === 1 ? vendors[0].id : null;
  if (label.label === "statement") return { linkedInvoiceId: null, linkedVendorId: vendorId };

  const { numberKey } = invoiceNumberKeys(label.invoiceNumber);
  if (!numberKey || vendors.length === 0) return { linkedInvoiceId: null, linkedVendorId: vendorId };
  const matches = await tx.invoice.findMany({
    where: { vendorId: { in: vendors.map((v) => v.id) }, numberKey, status: { notIn: ["duplicate", "void"] } },
    select: { id: true, vendorId: true },
  });
  if (matches.length !== 1) return { linkedInvoiceId: null, linkedVendorId: vendorId };
  return { linkedInvoiceId: matches[0].id, linkedVendorId: matches[0].vendorId };
}

/**
 * Asks the labeller about an email without attachments, unless it is already labelled.
 * Call outside any transaction: it may be a network call.
 */
export async function labelFor(prisma: Tx, email: IntakeEmail, labeller: EmailLabeller): Promise<LabelResult | null> {
  if (!needsLabel(email)) return null;
  const existing = await prisma.inboxEmail.findUnique({ where: { id: email.emailId }, select: { label: true } });
  if (existing?.label) return null;
  return labeller.label({
    emailId: email.emailId,
    fromName: email.fromName,
    fromAddress: email.fromAddress,
    subject: email.subject,
    body: email.body,
  });
}

export interface IntakeEmailInput {
  /** The attachment files by name; null when the file is missing from the batch. */
  files: ReadonlyMap<string, Uint8Array | null>;
  /** From `labelFor`; null when the email has attachments or is already labelled. */
  label: LabelResult | null;
  source?: "inbox" | "upload";
}

export async function intakeEmail(tx: Tx, email: IntakeEmail, input: IntakeEmailInput): Promise<EmailOutcome> {
  const source = input.source ?? "inbox";
  const existing = await tx.inboxEmail.findUnique({ where: { id: email.emailId }, select: { id: true } });
  if (!existing) {
    await tx.inboxEmail.create({
      data: {
        id: email.emailId,
        fromName: email.fromName,
        fromAddress: email.fromAddress,
        toAddress: email.toAddress,
        subject: email.subject,
        receivedAt: timestamp(email.receivedAt),
        body: email.body,
        attachments: email.attachments,
        source,
      },
    });
  }

  const attachments: AttachmentOutcome[] = [];
  for (const fileName of email.attachments) {
    const bytes = input.files.get(fileName) ?? null;
    if (bytes === null) {
      attachments.push({ fileName, status: "missing_file" });
      continue;
    }
    attachments.push(
      await storeAndDraft(tx, fileName, bytes, {
        source,
        emailId: email.emailId,
        receivedDate: dateOnly(receivedDateOf(email.receivedAt)),
      }),
    );
  }

  let label: EmailOutcome["label"] = null;
  if (input.label) {
    if (input.label.ok) {
      const linked = await links(tx, email, input.label);
      const source = input.label.source === "claude" ? "model" : "recorded";
      await tx.inboxEmail.update({
        where: { id: email.emailId },
        data: { label: input.label.label, labelReason: input.label.reason, labelSource: source, ...linked },
      });
      label = { label: input.label.label, reason: input.label.reason, source, ...linked };
    } else {
      // Left unlabelled so the next run asks again; the reason shows in "Needs attention".
      await tx.inboxEmail.update({
        where: { id: email.emailId },
        data: { label: null, labelReason: input.label.detail, labelSource: null },
      });
      label = { label: null, reason: input.label.detail, source: null, linkedInvoiceId: null, linkedVendorId: null };
    }
  }

  return { emailId: email.emailId, newEmail: !existing, attachments, label };
}

/** A loose upload: no email; received today. */
export async function intakeFile(
  tx: Tx,
  file: { fileName: string; bytes: Uint8Array },
  opts: { uploadedById?: string | null; receivedDate?: IsoDate } = {},
): Promise<AttachmentOutcome> {
  return storeAndDraft(tx, file.fileName, file.bytes, {
    source: "upload",
    uploadedById: opts.uploadedById ?? null,
    receivedDate: dateOnly(opts.receivedDate ?? today()),
  });
}

/**
 * The whole flow for a batch of emails: label (outside a transaction), then one transaction
 * per email. `readFile` returns null for a file that is not in the batch.
 */
export async function ingestEmails(
  db: Db,
  emails: readonly IntakeEmail[],
  opts: {
    readFile: (name: string) => Uint8Array | null;
    labeller: EmailLabeller;
    source?: "inbox" | "upload";
    inTransaction?: InTransaction;
  },
): Promise<EmailOutcome[]> {
  const inTransaction = opts.inTransaction ?? transactionsOn(db);
  const out: EmailOutcome[] = [];
  for (const email of emails) {
    const label = await labelFor(db, email, opts.labeller);
    const files = new Map(email.attachments.map((n) => [n, opts.readFile(n)] as const));
    out.push(await inTransaction((tx) => intakeEmail(tx, email, { files, label, source: opts.source })));
  }
  return out;
}
