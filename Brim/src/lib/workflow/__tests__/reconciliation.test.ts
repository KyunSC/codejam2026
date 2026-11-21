/** Reconciliation against the local database (history statement and payments), rolled back. */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { harborline, hasLocalDb } from "@/lib/workflow-test/local-db";

class Rollback extends Error {}

async function withTx(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  await prisma
    .$transaction(
      async (tx: Prisma.TransactionClient) => {
        vi.doMock("@/lib/db", () => ({ db: () => tx }));
        vi.resetModules();
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
}

describe.runIf(hasLocalDb)("reconciliation", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });

  it("reproduces BUILD_PLAN's counts from the DB, and Mark explained is audited and enforced", async () => {
    prisma = (await import("@/lib/db")).db();
    await withTx(prisma, async (tx) => {
      const org = await harborline(tx);
      const user = (id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });
      // Only the history statement: drop simulated lines and app payments made by other tests' commits, if any.
      await tx.bankStatementLine.deleteMany({ where: { organizationId: org, source: { not: "history" } } });
      await tx.payment.deleteMany({ where: { organizationId: org, source: { not: "history" } } });
      const { reconciliation, markExplained } = await import("../reconciliation");
      const { workflowActor } = await import("../guard");

      const auditor = await user("U006");
      const r = await reconciliation(auditor);
      expect(r.summary).toMatchObject({ lines: 354, eft: 313, cheques: 20, withDifference: 4, monthlyFees: 10, wireFees: 6, unexplained: 5, paymentsWithoutLine: 15, clearedButOutstanding: 20 });
      expect(r.canExplain).toBe(false);
      await expect(reconciliation(await user("U004"))).rejects.toMatchObject({ status: 403 });

      const fm = workflowActor(await user("U003"));
      const line = r.unexplained[0];
      await expect(markExplained(tx, workflowActor(auditor), org, { lineId: line.id, note: "x" })).rejects.toMatchObject({ status: 403 });
      await expect(markExplained(tx, fm, org, { lineId: line.id, note: " " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await expect(markExplained(tx, fm, org, { lineId: "BK-00001", note: "x" })).rejects.toMatchObject({ code: "ALREADY_MATCHED" });
      await expect(markExplained(tx, fm, org, { lineId: "BK-99999", note: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });

      await markExplained(tx, fm, org, { lineId: line.id, note: "Insurance pre-authorised debit; agreement on file" });
      await expect(markExplained(tx, fm, org, { lineId: line.id, note: "again" })).rejects.toMatchObject({ code: "ALREADY_EXPLAINED" });
      const audit = await tx.auditEvent.findFirstOrThrow({ where: { organizationId: org, action: "reconciliation.explain", entityId: line.id } });
      expect(audit.reason).toBe("Insurance pre-authorised debit; agreement on file");

      const pay = r.paymentsWithoutLine[0];
      await markExplained(tx, fm, org, { paymentId: pay.id, note: "Scheduled for next run" });

      const after = await reconciliation(auditor);
      expect(after.summary.unexplained).toBe(4);
      expect(after.summary.explained).toBe(2);
      expect(after.unexplained.find((u) => u.id === line.id)!.explained).toMatchObject({ note: "Insurance pre-authorised debit; agreement on file", by: fm.user.fullName });
    });
  }, 60_000);
});
