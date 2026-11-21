/** "Waiting for me" and the approver's read scope, against the local database, rolled back. */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { harborline, hasLocalDb } from "@/lib/workflow-test/local-db";

class Rollback extends Error {}

describe.runIf(hasLocalDb)("waitingForMe", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });

  it("shows the current step to its assignee and to the delegate of an assignee on leave", async () => {
    const { db } = await import("@/lib/db");
    prisma = db();
    await prisma
      .$transaction(
        async (tx: Prisma.TransactionClient) => {
          // The queue reads through db(); point it at this transaction.
          vi.doMock("@/lib/db", () => ({ db: () => tx }));
          vi.resetModules();
          const { waitingForMe } = await import("../queues");
          const { submit, decide } = await import("../approvals");
          const { workflowActor } = await import("../guard");
          const { listInvoicesFor } = await import("@/lib/invoices/service");
          const org = await harborline(tx);
          const user = (id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });
          const inv = await tx.invoice.create({
            data: {
              organizationId: org, id: "TEST-Q1", source: "manual", status: "coded", vendorId: "V024", departmentId: "D07",
              currency: "CAD", total: "18000.00", totalCad: "18000.00",
              lines: { create: [{ lineNo: 1, description: "Rent", amount: "18000.00", glSuggested: "6210", glFinal: "6210" }] },
            },
          });
          await submit(tx, workflowActor(await user("U004")), org, inv.id, null);
          // Step 1 is U003 for U012 (on leave): U003 sees it, U012 does not, U002 not yet.
          expect((await waitingForMe(await user("U003"))).map((r) => [r.invoice.id, r.actingFor])).toEqual([["TEST-Q1", "Liam O'Connor"]]);
          expect(await waitingForMe(await user("U002"))).toEqual([]);
          await decide(tx, workflowActor(await user("U003")), { organizationId: org, invoiceId: inv.id, decision: "approve", comment: null, ifMatch: null });
          expect((await waitingForMe(await user("U002"))).map((r) => r.stepNo)).toEqual([2]);
          expect(await waitingForMe(await user("U003"))).toEqual([]);
          // An approver reads invoices with a step for them and their own department's.
          const u007 = await user("U007");
          const mine = await listInvoicesFor(u007, {});
          const ids = [...mine.inProgress, ...mine.sent].map((r) => r.id);
          expect(ids).not.toContain("TEST-Q1");
          expect(ids.length).toBeGreaterThan(0);
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
