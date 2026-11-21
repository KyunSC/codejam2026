/**
 * The inbox ingest, end to end, inside one rolled-back transaction: 41 drafts, two for EM-029,
 * the four attachment-less emails labelled, nothing sealed read, and a second run changes nothing.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../../db";
import { createExtractor } from "../extract";
import { MemoryExtractionCache } from "../extract/cache";
import { ingestInbox } from "../ingest";
import { RecordedEmailLabeller } from "../label/recorded";
import { inRollback } from "./db-helpers";

const hasDb = !!process.env.DATABASE_URL?.trim();

describe.runIf(hasDb)("ingestInbox (rolled back)", () => {
  const prisma = hasDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasDb) await prisma.$disconnect();
  });

  it("drafts the 41 unsealed files, labels EM-056..059, and is safe to run twice", async () => {
    await inRollback(
      prisma,
      async (tx: Prisma.TransactionClient) => {
        const opts = {
          labeller: new RecordedEmailLabeller(),
          extractor: createExtractor({ env: {}, cache: new MemoryExtractionCache() }),
          inTransaction: <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => fn(tx),
        };
        const r = await ingestInbox(tx, { ...opts, run: true });
        expect(r).toMatchObject({ emails: 44, sealedEmailsSkipped: 15, draftsCreated: 41, alreadyReceived: 0 });
        expect(r.missingFiles).toEqual([]);
        expect(r.draftsByEmail["EM-029"]).toHaveLength(2);
        expect(r.labels).toEqual({
          "EM-056": "statement",
          "EM-057": "payment_inquiry",
          "EM-058": "missing_attachment",
          "EM-059": "other",
        });
        // A hand-made answer for every file.
        expect(r.ends).toEqual({ extracted: 41 });

        expect(await tx.invoice.count({ where: { source: "inbox" } })).toBe(41);
        expect(await tx.document.count()).toBe(41);
        // The four by the labeller, the 40 with attachments by what the attachment is.
        expect(await tx.inboxEmail.count({ where: { label: { not: null } } })).toBe(4 + 40);

        const again = await ingestInbox(tx, opts);
        expect(again).toMatchObject({ draftsCreated: 0, alreadyReceived: 41, labels: {} });
        expect(await tx.invoice.count({ where: { source: "inbox" } })).toBe(41);
      },
      120_000,
    );
  });
});
