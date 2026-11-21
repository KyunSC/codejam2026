/**
 * BUILD_PLAN Testing, "Broken inputs": zero-byte file, truncated PDF, password-protected PDF,
 * blank image, a photo that is not an invoice, a two-page PDF, the same file twice. Each goes
 * through intake and run.ts and ends in a named state, with no exception.
 *
 * All made up here. The model is a stub that answers like the real one would for the two files
 * that open (the photo is "other", the two-page PDF an invoice), so the test needs no key.
 * Runs against the local database inside a transaction that is rolled back.
 */
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { Extracted } from "../../types";
import { db } from "../../db";
import type { Extractor } from "../extract";
import { intakeFile, sha256Of, type AttachmentOutcome } from "../intake";
import { commit, prepare, type RunOutcome } from "../run";
import { inRollback } from "./db-helpers";
import { buildPdf } from "./pdf-builder";

const hasDb = !!process.env.DATABASE_URL?.trim();

const PAGE_1 = "Test Supplies Inc.\nINVOICE\nInvoice 9002\nDate 2026-10-28\nWidgets 2 50.00 100.00";
const PAGE_2 = "Page 2 of 2\nSubtotal 100.00\nHST 13% 13.00\nTotal CAD 113.00";

const TWO_PAGE_ANSWER: Extracted = {
  docType: "invoice",
  language: "en",
  vendor: { name: "Test Supplies Inc.", address: null, gstHstNumber: null, qstNumber: null },
  billTo: { name: null, address: null },
  invoiceNumber: "9002",
  invoiceDate: "2026-10-28",
  dueDate: null,
  terms: null,
  poNumber: null,
  creditNoteRef: null,
  currency: "CAD",
  lines: [{ description: "Widgets", quantity: "2", unitPrice: "50.00", amount: "100.00" }],
  subtotal: "100.00",
  taxes: [{ label: "HST 13%", amount: "13.00" }],
  total: "113.00",
  remit: { institution: null, transit: null, account: null, text: null },
  notes: [],
  unreadable: [],
};

const PHOTO_ANSWER: Extracted = {
  ...TWO_PAGE_ANSWER,
  docType: "other",
  vendor: { name: null, address: null, gstHstNumber: null, qstNumber: null },
  invoiceNumber: null,
  invoiceDate: null,
  currency: null,
  lines: [],
  subtotal: null,
  taxes: [],
  total: null,
};

async function makeInputs() {
  const invoicePdf = buildPdf([`${PAGE_1}\n${PAGE_2}`]);
  const blank = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
  // A "photo": shapes and colour, no writing.
  const photo = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#7fb3d5"/><circle cx="320" cy="260" r="140" fill="#f5b041"/><rect y="380" width="640" height="100" fill="#52be80"/></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  const twoPage = buildPdf([PAGE_1, PAGE_2]);
  return {
    "empty.pdf": new Uint8Array(),
    "truncated.pdf": invoicePdf.subarray(0, invoicePdf.length >> 1),
    "protected.pdf": buildPdf([`${PAGE_1}\n${PAGE_2}`], { userPassword: "s3cret" }),
    "blank.png": blank,
    "photo.jpg": photo,
    "two-page.pdf": twoPage,
  } as const;
}

describe.runIf(hasDb)("broken inputs end in named states (rolled back)", () => {
  const prisma = hasDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasDb) await prisma.$disconnect();
  });

  it("names every one, and the same file twice makes one draft", async () => {
    const inputs = await makeInputs();
    const answers = new Map<string, Extracted>([
      [sha256Of(inputs["photo.jpg"]), PHOTO_ANSWER],
      [sha256Of(inputs["two-page.pdf"]), TWO_PAGE_ANSWER],
    ]);
    const stub: Extractor = {
      kind: "claude",
      extract: async (input) => {
        const x = answers.get(input.sha256);
        if (!x) throw new Error(`the stub was asked about a file that should not reach the model`);
        return { ok: true, extracted: structuredClone(x), secondRead: null, source: "claude", model: "stub" };
      },
    };

    await inRollback(prisma, async (tx: Prisma.TransactionClient) => {
      const intake: Record<string, AttachmentOutcome> = {};
      for (const [name, bytes] of Object.entries(inputs)) {
        intake[name] = await intakeFile(tx, { fileName: name, bytes });
      }
      // The same file a second time, under another name.
      const again = await intakeFile(tx, { fileName: "two-page (1).pdf", bytes: inputs["two-page.pdf"] });

      expect(Object.values(intake).map((a) => a.status)).toEqual(Object.keys(inputs).map(() => "draft"));
      expect(again).toMatchObject({
        status: "already_received",
        invoiceId: "invoiceId" in intake["two-page.pdf"] ? intake["two-page.pdf"].invoiceId : "",
      });

      const ends: Record<string, Pick<RunOutcome, "end" | "detail">> = {};
      for (const [name, a] of Object.entries(intake)) {
        const id = "invoiceId" in a ? a.invoiceId : "";
        const { end, detail } = await commit(tx, await prepare(tx, id, stub));
        ends[name] = { end, detail };
      }

      expect(ends).toEqual({
        "empty.pdf": { end: "unreadable", detail: expect.stringMatching(/empty/) },
        "truncated.pdf": { end: "unreadable", detail: expect.stringMatching(/does not open/) },
        "protected.pdf": { end: "unreadable", detail: expect.stringMatching(/password-protected/) },
        "blank.png": { end: "unreadable", detail: expect.stringMatching(/blank/) },
        "photo.jpg": { end: "not_invoice", detail: expect.stringMatching(/not an invoice/) },
        "two-page.pdf": { end: "extracted", detail: expect.any(String) },
      });

      const drafts = await tx.invoice.findMany({
        where: { source: "upload" },
        include: { flags: true, document: true },
      });
      expect(drafts).toHaveLength(6);
      const byFile = Object.fromEntries(drafts.map((d) => [d.document!.fileName, d]));
      for (const name of ["empty.pdf", "truncated.pdf", "protected.pdf", "blank.png"]) {
        expect(byFile[name].status).toBe("needs_review");
        expect(byFile[name].flags.map((f) => [f.code, f.effect, f.status])).toEqual([["UNREADABLE", "hold", "open"]]);
      }
      expect(byFile["protected.pdf"].flags[0].evidence).toContainEqual({
        label: "Problem",
        value: "encrypted",
        source: "intake",
      });
      expect(byFile["photo.jpg"]).toMatchObject({ status: "needs_review", docType: "other", flags: [] });
      expect(byFile["two-page.pdf"]).toMatchObject({
        status: "extracted",
        vendorInvoiceNumber: "9002",
        flags: [],
        document: { pageCount: 2 },
      });
      expect(byFile["two-page.pdf"].total!.toString()).toBe("113");
      // Values on page 2 are checked against page 2's text.
      expect(byFile["two-page.pdf"].evidence).toMatchObject({ total: "confirmed", "taxes.0.label": "confirmed" });
    });
  });
});
