/**
 * Intake against the local database. Every test runs inside a transaction that is rolled back,
 * so the seeded state is left as it was. Skipped when DATABASE_URL is not set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { datasetDir, loadEmails } from "../../dataset";
import { db } from "../../db";
import { allocateInvoiceIds, intakeEmail, intakeFile, labelFor, receivedDateOf, type IntakeEmail } from "../intake";
import type { EmailLabeller } from "../label";
import { RecordedEmailLabeller } from "../label/recorded";
import { sealedFileNames } from "../sealed";
import { inRollback as rollback } from "./db-helpers";
import { buildPdf } from "./pdf-builder";

const hasDb = !!process.env.DATABASE_URL?.trim();

describe("receivedDateOf", () => {
  it("keeps the date as written", () => {
    expect(receivedDateOf("2026-10-29T23:59:00")).toBe("2026-10-29");
  });
});

describe.runIf(hasDb)("intake (rolled back)", () => {
  const prisma = hasDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasDb) await prisma.$disconnect();
  });

  const inRollback = (fn: (tx: Prisma.TransactionClient) => Promise<void>) => rollback(prisma, fn);

  const sealed = sealedFileNames();
  const emails = new Map(loadEmails().map((e) => [e.emailId, e]));
  const readDataset = (name: string) => {
    if (sealed.has(name)) throw new Error(`test tried to read sealed ${name}`);
    return new Uint8Array(readFileSync(path.join(datasetDir(), "incoming_invoices", name)));
  };
  const filesOf = (e: IntakeEmail) => new Map(e.attachments.map((n) => [n, readDataset(n)] as const));
  const made: IntakeEmail = {
    emailId: "EM-TEST-1",
    fromName: "Test Sender",
    fromAddress: "ar@test-sender.example",
    toAddress: "ap@harborline-logistics.example",
    subject: "Invoice",
    receivedAt: "2026-11-01T10:00:00",
    body: "Attached.",
    attachments: ["copy.pdf"],
  };

  it("gives the next AP ids after the history", async () => {
    await inRollback(async (tx) => {
      expect(await allocateInvoiceIds(tx, 2)).toEqual(["AP-00427", "AP-00428"]);
    });
  });

  it("makes one draft per attachment: EM-029 gives two, pointing at the seeded documents", async () => {
    const em029 = emails.get("EM-029")!;
    await inRollback(async (tx) => {
      const out = await intakeEmail(tx, em029, { files: filesOf(em029), label: null });
      expect(out.newEmail).toBe(false);
      expect(out.label).toBeNull();
      expect(out.attachments.map((a) => a.status)).toEqual(["draft", "draft"]);
      const drafts = await tx.invoice.findMany({ where: { email: { sourceId: "EM-029" } }, orderBy: { id: "asc" } });
      expect(drafts.map((d) => [d.id, d.status, d.source, d.receivedDate.toISOString().slice(0, 10)])).toEqual([
        ["AP-00427", "received", "inbox", "2026-10-29"],
        ["AP-00428", "received", "inbox", "2026-10-29"],
      ]);
      expect(out.attachments.every((a) => a.status === "draft" && !a.newDocument)).toBe(true);
      expect(await tx.document.count({ where: { organization: { slug: "harborline" } } })).toBe(41);
    });
  });

  it("does not make a second draft for the same bytes, from the same email or another", async () => {
    const em029 = emails.get("EM-029")!;
    await inRollback(async (tx) => {
      const first = await intakeEmail(tx, em029, { files: filesOf(em029), label: null });
      const again = await intakeEmail(tx, em029, { files: filesOf(em029), label: null });
      const firstIds = first.attachments.map((a) => ("invoiceId" in a ? a.invoiceId : null));
      expect(again.attachments.map((a) => a.status)).toEqual(["already_received", "already_received"]);
      expect(again.attachments.map((a) => ("invoiceId" in a ? a.invoiceId : null))).toEqual(firstIds);

      const copy = await intakeEmail(tx, made, {
        files: new Map([["copy.pdf", readDataset(em029.attachments[0])]]),
        label: null,
      });
      expect(copy.newEmail).toBe(true);
      expect(copy.attachments[0]).toMatchObject({ status: "already_received", invoiceId: firstIds[0] });
      expect(
        await tx.invoice.count({ where: { organization: { slug: "harborline" }, source: { not: "history" } } }),
      ).toBe(2);
    });
  });

  it("names an attachment missing from the batch and makes no draft for it", async () => {
    await inRollback(async (tx) => {
      const out = await intakeEmail(tx, made, { files: new Map([["copy.pdf", null]]), label: null });
      expect(out.attachments).toEqual([{ fileName: "copy.pdf", status: "missing_file" }]);
      expect(await tx.invoice.count({ where: { email: { sourceId: made.emailId } } })).toBe(0);
      expect(await tx.inboxEmail.findFirst({ where: { sourceId: made.emailId } })).toMatchObject({ source: "inbox" });
    });
  });

  it("labels the four attachment-less emails and links the inquiry and the statement", async () => {
    const labeller = new RecordedEmailLabeller();
    await inRollback(async (tx) => {
      const got: Record<string, unknown> = {};
      for (const id of ["EM-056", "EM-057", "EM-058", "EM-059"]) {
        const e = emails.get(id)!;
        const label = await labelFor(tx, e, labeller);
        got[id] = (await intakeEmail(tx, e, { files: new Map(), label })).label;
      }
      expect(got).toEqual({
        "EM-056": expect.objectContaining({ label: "statement", source: "recorded", linkedVendorId: "V001" }),
        "EM-057": expect.objectContaining({
          label: "payment_inquiry",
          linkedInvoiceId: "AP-00049",
          linkedVendorId: "V044",
        }),
        "EM-058": expect.objectContaining({ label: "missing_attachment", linkedInvoiceId: null, linkedVendorId: null }),
        "EM-059": expect.objectContaining({ label: "other", linkedInvoiceId: null, linkedVendorId: null }),
      });
      expect(
        await tx.inboxEmail.findFirst({ where: { organization: { slug: "harborline" }, sourceId: "EM-057" } }),
      ).toMatchObject({
        label: "payment_inquiry",
        labelSource: "recorded",
        linkedInvoiceId: "AP-00049",
      });
      // Already labelled: the labeller is not asked again.
      expect(await labelFor(tx, emails.get("EM-057")!, labeller)).toBeNull();
    });
  });

  it("does not label an email with attachments, and leaves a failed label empty with the reason", async () => {
    const failing: EmailLabeller = {
      kind: "claude",
      label: async () => ({ ok: false, reason: "api_error", detail: "The model call failed (529): Overloaded" }),
    };
    await inRollback(async (tx) => {
      expect(await labelFor(tx, emails.get("EM-029")!, failing)).toBeNull();
      const e = emails.get("EM-058")!;
      const out = await intakeEmail(tx, e, { files: new Map(), label: await labelFor(tx, e, failing) });
      expect(out.label).toMatchObject({ label: null, source: null, reason: /Overloaded/ });
      expect(
        await tx.inboxEmail.findFirst({ where: { organization: { slug: "harborline" }, sourceId: "EM-058" } }),
      ).toMatchObject({
        label: null,
        labelReason: "The model call failed (529): Overloaded",
      });
    });
  });

  it("takes a loose upload: stores the bytes, drafts it as received today, once", async () => {
    const pdf = buildPdf(["Test Supplies Inc.\nInvoice 9001\nTotal 113.00"]);
    await inRollback(async (tx) => {
      const out = await intakeFile(tx, { fileName: "upload.pdf", bytes: pdf }, { uploadedById: null });
      expect(out).toMatchObject({ status: "draft", newDocument: true, invoiceId: "AP-00427" });
      const doc = await tx.document.findFirst({ where: { sha256: out.status === "draft" ? out.sha256 : "" } });
      expect(doc).toMatchObject({
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        url: null,
        fileName: "upload.pdf",
      });
      expect(Buffer.from(doc!.content).equals(pdf)).toBe(true);
      expect(await tx.invoice.findUnique({ where: { id: "AP-00427" } })).toMatchObject({
        source: "upload",
        status: "received",
        emailId: null,
        receivedDate: new Date("2026-11-02T00:00:00Z"),
      });
      expect(await intakeFile(tx, { fileName: "again.pdf", bytes: pdf })).toMatchObject({
        status: "already_received",
        invoiceId: "AP-00427",
      });
    });
  });
});
