/**
 * run.ts against the local database, inside transactions that are rolled back. Uses the
 * recorded (hand-made) extractor, so it needs no API key. Skipped without DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { datasetDir, loadEmails } from "../../dataset";
import { db } from "../../db";
import { createExtractor, type Extractor } from "../extract";
import { MemoryExtractionCache } from "../extract/cache";
import { loadRecordedAnswers } from "../extract/recorded";
import { intakeEmail, intakeFile } from "../intake";
import { commit, documentBytes, prepare, type RunOutcome } from "../run";
import { sealedFileNames } from "../sealed";
import { inRollback as rollback } from "./db-helpers";
import { buildPdf } from "./pdf-builder";

const hasDb = !!process.env.DATABASE_URL?.trim();
describe("documentBytes", () => {
  it("refuses a sealed dataset file and a path outside the folder", () => {
    const sealed = [...sealedFileNames()][0];
    expect(() => documentBytes({ data: null, url: `dataset:incoming_invoices/${sealed}`, fileName: sealed })).toThrow(
      /sealed/,
    );
    expect(() => documentBytes({ data: null, url: "dataset:incoming_invoices/../x.pdf", fileName: "x" })).toThrow(
      /Bad dataset url/,
    );
  });
});

describe.runIf(hasDb)("run (rolled back)", () => {
  const prisma = hasDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasDb) await prisma.$disconnect();
  });

  const inRollback = (fn: (tx: Prisma.TransactionClient) => Promise<void>) => rollback(prisma, fn);

  const sealed = sealedFileNames();
  const read = (name: string) => {
    if (sealed.has(name)) throw new Error(`test tried to read sealed ${name}`);
    return new Uint8Array(readFileSync(path.join(datasetDir(), "incoming_invoices", name)));
  };
  const recorded = () => createExtractor({ env: {}, cache: new MemoryExtractionCache() });
  const run = async (tx: Prisma.TransactionClient, id: string, x: Extractor = recorded()) =>
    commit(tx, await prepare(tx, id, x));

  /** Intakes the inbox email carrying `file` and returns that file's draft id. */
  async function draftFor(tx: Prisma.TransactionClient, file: string): Promise<string> {
    const email = loadEmails().find((e) => e.attachments.includes(file))!;
    const files = new Map(email.attachments.map((n) => [n, read(n)] as const));
    const out = await intakeEmail(tx, email, { files, label: null });
    const a = out.attachments.find((x) => x.fileName === file)!;
    return "invoiceId" in a ? a.invoiceId : "";
  }

  it("takes each hand-made fixture file to a stored, normalised invoice", async () => {
    const files = [...loadRecordedAnswers().values()].map((a) => a.file).sort();
    await inRollback(async (tx) => {
      const ends: Record<string, RunOutcome["end"]> = {};
      for (const f of files) ends[f] = (await run(tx, await draftFor(tx, f))).end;
      // Arithmetic errors on two of them are flags for the checks stage, not reading problems.
      expect(Object.values(ends)).toEqual(files.map(() => "extracted"));

      const credit = await tx.invoice.findFirst({
        where: { document: { fileName: "greatlakescarrie-inv-025.pdf" } },
        include: { lines: true, taxes: true, document: true, email: true },
      });
      expect(credit).toMatchObject({ kind: "credit_note", docType: "credit_note", currency: "CAD" });
      expect(credit!.total!.toString()).toBe("-672");
      expect(credit!.lines.length).toBeGreaterThan(0);
      expect(credit!.taxes.every((t) => t.taxCode !== null)).toBe(true);
      expect(credit!.document!.textLayer).toMatch(/672/);
      expect(credit!.document!.pageCount).toBe(1);
      expect(credit!.email).toMatchObject({ label: "credit_note", labelSource: "rule" });
      expect(credit!.normalized).toMatchObject({ extraction: { source: "recorded", model: "hand-made" } });
      expect(credit!.evidence).toMatchObject({ total: "confirmed" });

      const french = await tx.invoice.findFirst({
        where: { document: { fileName: "laurentianlogist_FA002399.pdf" } },
        include: { taxes: true },
      });
      expect(french!.pstQstAmount).not.toBeNull();
      expect(french!.gstHstAmount).not.toBeNull();
    });
  });

  it("leaves a file with no answer in received, with its inspection stored, for the next run", async () => {
    const recordedFiles = new Set([...loadRecordedAnswers().values()].map((a) => a.file));
    const email = loadEmails().find((e) => e.attachments.length === 1 && !recordedFiles.has(e.attachments[0]))!;
    const file = email.attachments[0];
    expect(sealed.has(file)).toBe(false);
    await inRollback(async (tx) => {
      const id = await draftFor(tx, file);
      const r = await run(tx, id);
      expect(r).toMatchObject({ end: "not_extracted", fileName: file });
      const inv = await tx.invoice.findUnique({ where: { id }, include: { document: true } });
      expect(inv!.status).toBe("received");
      expect(inv!.document!.textLayer!.length).toBeGreaterThan(300);
    });
  });

  it("ends a file that does not open as needs_review with UNREADABLE", async () => {
    await inRollback(async (tx) => {
      const a = await intakeFile(tx, { fileName: "empty.pdf", bytes: new Uint8Array() });
      const id = "invoiceId" in a ? a.invoiceId : "";
      expect(await run(tx, id)).toMatchObject({ end: "unreadable", fileName: "empty.pdf" });
      const inv = await tx.invoice.findUnique({ where: { id }, include: { flags: true } });
      expect(inv!.status).toBe("needs_review");
      expect(inv!.flags).toEqual([
        expect.objectContaining({ code: "UNREADABLE", klass: "data", effect: "hold", status: "open" }),
      ]);
      expect(inv!.flags[0].message).toMatch(/empty/);
    });
  });

  it("ends an unusable answer as UNREADABLE and a statement as a non-invoice", async () => {
    const answer = [...loadRecordedAnswers().values()][0].extracted;
    const bad: Extractor = {
      kind: "claude",
      extract: async () => ({ ok: false, reason: "bad_answer", detail: "The model's answer was not JSON." }),
    };
    const statement: Extractor = {
      kind: "claude",
      extract: async () => ({
        ok: true,
        extracted: { ...answer, docType: "statement" },
        secondRead: null,
        source: "claude",
        model: "test",
      }),
    };
    await inRollback(async (tx) => {
      const one = await intakeFile(tx, { fileName: "a.pdf", bytes: buildPdf(["Invoice 1\nTotal 10.00 lorem ipsum"]) });
      const two = await intakeFile(tx, { fileName: "b.pdf", bytes: buildPdf(["Statement of account lorem ipsum"]) });
      const id1 = "invoiceId" in one ? one.invoiceId : "";
      const id2 = "invoiceId" in two ? two.invoiceId : "";
      expect(await run(tx, id1, bad)).toMatchObject({ end: "unreadable", detail: /not JSON/ });
      expect(await run(tx, id2, statement)).toMatchObject({ end: "not_invoice", detail: /statement/ });
      expect(await tx.invoice.findUnique({ where: { id: id2 } })).toMatchObject({
        status: "needs_review",
        docType: "statement",
        normalized: null,
      });
    });
  });

  it("treats an extractor that throws as not extracted, and skips a draft already moved", async () => {
    const throwing: Extractor = {
      kind: "claude",
      extract: async () => {
        throw new Error("socket hang up");
      },
    };
    await inRollback(async (tx) => {
      const a = await intakeFile(tx, { fileName: "c.pdf", bytes: buildPdf(["Invoice 2\nTotal 20.00 lorem ipsum"]) });
      const id = "invoiceId" in a ? a.invoiceId : "";
      expect(await run(tx, id, throwing)).toMatchObject({ end: "not_extracted", detail: /socket hang up/ });
      await tx.invoice.update({ where: { id }, data: { status: "needs_review" } });
      expect(await prepare(tx, id, throwing)).toMatchObject({ kind: "skip", detail: "Already needs_review." });
    });
  });
});
