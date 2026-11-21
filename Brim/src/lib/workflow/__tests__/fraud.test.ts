/** Fraud watch and the release block, against the local database, rolled back. */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { harborline, hasInboxDrafts } from "@/lib/workflow-test/local-db";

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

describe.runIf(hasInboxDrafts)("fraud watch", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });

  it("lists the lookalike sender on AP-00447 with its amount, refuses other roles, and vendor-level or confirmed fraud flags block release", async () => {
    prisma = (await import("@/lib/db")).db();
    await withTx(prisma, async (tx) => {
      const org = await harborline(tx);
      const user = (id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });
      const { processInvoice } = await import("../process");
      const { fraudWatch } = await import("../fraud");
      const { paymentBlockers } = await import("../payments");

      await processInvoice(tx, { organizationId: org, invoiceId: "AP-00447", actor: { type: "system" } });
      const fm = await user("U003");
      const out = await fraudWatch(fm);
      const sender = out.rows.find((r) => r.code === "SENDER_LOOKALIKE_DOMAIN");
      expect(sender).toMatchObject({ scope: "invoice", invoice: { id: "AP-00447" }, vendor: { id: "V052" } });
      expect(sender!.message).toMatch(/harlowandstern-llp\.example.*harlow\.example/);
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: "AP-00447" } });
      expect(sender!.atStakeCad).toBe(Number(inv.totalCad ?? inv.total).toFixed(2));
      expect(out.rows.some((r) => r.code === "VENDOR_LOOKALIKE" && r.invoice?.id === "AP-00447")).toBe(true);
      expect(Number(out.totalAtStakeCad)).toBeGreaterThan(0);
      // Each invoice counted once though AP-00447 has two flags.
      const flaggedInvoices = new Set(out.rows.flatMap((r) => r.stakeInvoiceIds));
      expect(out.invoicesAtStake).toBe(flaggedInvoices.size);

      await expect(fraudWatch(await user("U004"))).rejects.toMatchObject({ status: 403 });
      await expect(fraudWatch(await user("U006"))).rejects.toMatchObject({ status: 403 });
      expect((await fraudWatch(await user("U002"))).rows.length).toBe(out.rows.length);

      // A fraud flag on the vendor alone holds every payment to it.
      const codes = async (id: string) => (await paymentBlockers(tx, org, id, "release")).map((b) => b.code);
      expect(await codes("AP-00462")).not.toContain("OPEN_HOLD");
      const vf = await tx.flag.create({
        data: { organizationId: org, vendorId: "V015", code: "BANK_MISMATCH", klass: "fraud", effect: "hold", message: "test", evidence: [] },
      });
      expect(await codes("AP-00462")).toContain("OPEN_HOLD");
      const withVendor = await fraudWatch(fm);
      const vrow = withVendor.rows.find((r) => r.flagId === vf.id)!;
      expect(vrow.scope).toBe("vendor");
      expect(vrow.stakeInvoiceIds).toContain("AP-00462");

      // Confirmed (not just open) fraud flags keep holding.
      await tx.flag.update({ where: { id: vf.id }, data: { vendorId: null, invoiceId: "AP-00462", status: "confirmed" } });
      expect(await codes("AP-00462")).toContain("OPEN_HOLD");
      expect((await fraudWatch(fm)).rows.some((r) => r.flagId === vf.id)).toBe(false);
    });
  }, 60_000);
});
