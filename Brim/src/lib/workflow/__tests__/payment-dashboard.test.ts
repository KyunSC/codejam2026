/** The payments dashboard on day one, against the local database (after scripts/day-one.ts or in rollback). */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDataset } from "@/lib/dataset";
import { replayHistory } from "@/lib/rules/replay";
import { today } from "@/lib/today";
import { harborline, hasLocalDb } from "@/lib/workflow-test/local-db";

class Rollback extends Error {}

describe.runIf(hasLocalDb)("payments dashboard, day one", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });

  it("opens on the duplicate pair and the vendor with the unverified bank change", async () => {
    const { db } = await import("@/lib/db");
    prisma = db();
    await prisma
      .$transaction(
        async (tx: Prisma.TransactionClient) => {
          // paymentsDashboard opens nested transactions on db(); give it a client whose $transaction runs inline.
          const inline = Object.assign(Object.create(tx), { $transaction: (fn: (t: Prisma.TransactionClient) => unknown) => fn(tx) });
          vi.doMock("@/lib/db", () => ({ db: () => inline }));
          vi.resetModules();
          const { paymentsDashboard } = await import("../payment-queries");
          const { flagOpenHistory } = await import("../payments");
          const org = await harborline(tx);
          await flagOpenHistory(tx, org, replayHistory(loadDataset(), today()).results);
          const d = await paymentsDashboard(org);
          const byInvoice = (id: string) => d.rows.filter((r) => r.invoiceId === id);
          expect(d.totals.awaiting_release.count).toBe(18);
          expect(d.totals.ready.count).toBe(2);
          expect(byInvoice("AP-00407")[0].blockers.map((b) => b.code)).toEqual(["OPEN_HOLD"]);
          expect(byInvoice("AP-00394")[0].blockers).toEqual([]);
          expect(byInvoice("AP-00426")[0].blockers.map((b) => b.code)).toEqual(["OPEN_HOLD", "BANK_CHANGE_UNVERIFIED"]);
          // Held rows come first; both 2026-11-02 duplicates are overdue on day one.
          expect(d.rows[0].blockers.length).toBeGreaterThan(0);
          expect(byInvoice("AP-00394")[0].buckets).toContain("due_this_week");
          expect(byInvoice("AP-00394")[0].releasers.length).toBeGreaterThan(0);
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }, 60_000);
});
