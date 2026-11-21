/** Payments against the local database (seed + ingest), rolled back. */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { loadDataset } from "@/lib/dataset";
import { db } from "@/lib/db";
import { replayHistory } from "@/lib/rules/replay";
import { today } from "@/lib/today";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { workflowActor } from "../guard";
import { flagOpenHistory, paymentBlockers, preparePayment, releasePayment, simulateBankRun } from "../payments";

type Tx = Prisma.TransactionClient;

async function ctx(tx: Tx) {
  const org = await harborline(tx);
  const user = (id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });
  const as = async (id: string) => workflowActor(await user(id));
  let n = 0;
  /** An approved manual invoice for `vendorId`, optionally with an approved step decided by `approver`. */
  const approved = async (vendorId: string, totalCad: string, approver?: string) => {
    n += 1;
    const inv = await tx.invoice.create({
      data: {
        organizationId: org, id: `TEST-P${n}`, source: "manual", status: "approved", vendorId, departmentId: "D01",
        currency: "CAD", total: totalCad, totalCad, fxRateToCad: "1", dueDate: new Date("2026-11-20T00:00:00Z"),
      },
    });
    if (approver) {
      const u = await user(approver);
      await tx.approvalStep.create({
        data: { organizationId: org, id: `${inv.id}-S1`, invoiceId: inv.id, stepNo: 1, role: "finance_manager", assignedToId: u.id, decidedById: u.id, decision: "approved", limitCad: "50000", why: {} },
      });
    }
    return inv;
  };
  const status = async (invoiceId: string) => (await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status;
  return { org, as, approved, status };
}

describe.runIf(hasLocalDb)("payments", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  const replay = hasLocalDb ? replayHistory(loadDataset(), today()).results : [];
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it("day one: AP-00407 is held as a duplicate of AP-00394, AP-00426 by the unverified bank change", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      await flagOpenHistory(tx, c.org, replay);
      expect(await flagOpenHistory(tx, c.org, replay)).toBe(0); // idempotent
      const p407 = await tx.payment.findFirstOrThrow({ where: { invoiceId: "AP-00407" } });
      expect((await paymentBlockers(tx, c.org, "AP-00407", "release")).map((b) => b.code)).toEqual(["OPEN_HOLD"]);
      expect((await paymentBlockers(tx, c.org, "AP-00394", "release")).map((b) => b.code)).toEqual([]);
      await expect(releasePayment(tx, await c.as("U002"), c.org, p407.id)).rejects.toMatchObject({ code: "OPEN_HOLD" });
      await expect(preparePayment(tx, await c.as("U004"), c.org, "AP-00426")).rejects.toMatchObject({ code: "OPEN_HOLD" });
      expect((await paymentBlockers(tx, c.org, "AP-00426", "prepare")).map((b) => b.code)).toEqual(["OPEN_HOLD", "BANK_CHANGE_UNVERIFIED"]);
    });
  });

  it("prepare → release → bank run → paid, for EFT, with a statement line that reconciles", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.approved("V024", "1234.56");
      const p = await preparePayment(tx, await c.as("U004"), c.org, inv.id);
      expect(p).toMatchObject({ method: "EFT", status: "scheduled" });
      expect(p.scheduledDate.toISOString().slice(0, 10)).toBe("2026-11-20");
      expect(await c.status(inv.id)).toBe("scheduled");
      await expect(preparePayment(tx, await c.as("U004"), c.org, inv.id)).rejects.toMatchObject({ code: "NOT_APPROVED" });
      await expect(releasePayment(tx, await c.as("U004"), c.org, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const r = await releasePayment(tx, await c.as("U003"), c.org, p.id);
      expect((r.bankSnapshot as { account: string }).account).toMatch(/^\d{8,9}$/);
      expect(await c.status(inv.id)).toBe("released");
      const run = await simulateBankRun(tx, await c.as("U004"), c.org);
      expect(run.settled).toContain(p.id);
      const done = await tx.payment.findFirstOrThrow({ where: { organizationId: c.org, id: p.id } });
      expect(done.reference).toMatch(/^BRIM-EFT-\d{8}$/);
      const line = await tx.bankStatementLine.findFirstOrThrow({ where: { organizationId: c.org, description: { endsWith: done.reference!.slice(-6) } } });
      expect(line.description).toBe(`EFT PMT PAPER TRAIL OFFICE SUPPL ${done.reference!.slice(-6)}`);
      expect(line.debit?.toString()).toBe("1234.56");
      expect(await c.status(inv.id)).toBe("paid");
    });
  });

  it("card writes an AP virtual-card charge; a cheque is sent, then clears on the next run", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const card = await c.approved("V015", "250.00");
      const chequeVendor = (await tx.vendor.findFirstOrThrow({ where: { organizationId: c.org, preferredPaymentMethod: "CHEQUE", status: "active" } })).id;
      const cheque = await c.approved(chequeVendor, "800.00");
      for (const i of [card, cheque]) {
        const p = await preparePayment(tx, await c.as("U004"), c.org, i.id);
        await releasePayment(tx, await c.as("U003"), c.org, p.id);
      }
      await simulateBankRun(tx, await c.as("U004"), c.org);
      const ct = await tx.cardTransaction.findFirstOrThrow({ where: { organizationId: c.org, cardId: `VC-${card.id}` } });
      expect(ct).toMatchObject({ source: "ap_virtual_card", memo: `AP payment ${card.id}`, merchantDescriptor: "CLOUDBARN SOFTWARE INC" });
      expect(await c.status(card.id)).toBe("paid");
      const chq = await tx.payment.findFirstOrThrow({ where: { organizationId: c.org, invoiceId: cheque.id } });
      expect(chq.status).toBe("sent");
      expect(await c.status(cheque.id)).toBe("released");
      const second = await simulateBankRun(tx, await c.as("U004"), c.org);
      expect(second.cleared).toContain(chq.id);
      expect(await c.status(cheque.id)).toBe("paid");
      expect(await tx.bankStatementLine.count({ where: { organizationId: c.org, description: `CHEQUE ${chq.reference!.slice(-4)} CLEARED` } })).toBe(1);
    });
  });

  it("an EFT to a 7-digit account fails with the reason and the invoice goes back to approved", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      await tx.vendorBankAccount.updateMany({ where: { organizationId: c.org, vendorId: "V024", validTo: null }, data: { account: "1234567" } });
      const inv = await c.approved("V024", "99.00");
      const p = await preparePayment(tx, await c.as("U004"), c.org, inv.id);
      await releasePayment(tx, await c.as("U003"), c.org, p.id);
      const run = await simulateBankRun(tx, await c.as("U004"), c.org);
      expect(run.failed.map((f) => f.paymentId)).toContain(p.id);
      const failed = await tx.payment.findFirstOrThrow({ where: { organizationId: c.org, id: p.id } });
      expect(failed.failureReason).toMatch(/1234567.* not 8 or 9 digits/);
      expect(await c.status(inv.id)).toBe("approved");
    });
  });

  it("release refuses an approver of the invoice, a payment over the limit, and an on-hold vendor", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const mine = await c.approved("V024", "500.00", "U003");
      const p1 = await preparePayment(tx, await c.as("U004"), c.org, mine.id);
      await expect(releasePayment(tx, await c.as("U003"), c.org, p1.id)).rejects.toMatchObject({ code: "APPROVER_CANNOT_RELEASE", status: 403 });
      await releasePayment(tx, await c.as("U002"), c.org, p1.id);

      const big = await c.approved("V024", "150000.00");
      const p2 = await preparePayment(tx, await c.as("U004"), c.org, big.id);
      await expect(releasePayment(tx, await c.as("U003"), c.org, p2.id)).rejects.toMatchObject({ code: "RELEASE_LIMIT" });
      await expect(releasePayment(tx, await c.as("U006"), c.org, p2.id)).rejects.toMatchObject({ code: "READ_ONLY_ROLE" });

      const held = await c.approved("V024", "10.00");
      const p3 = await preparePayment(tx, await c.as("U004"), c.org, held.id);
      await tx.vendor.update({ where: { organizationId_id: { organizationId: c.org, id: "V024" } }, data: { status: "on_hold" } });
      await expect(releasePayment(tx, await c.as("U002"), c.org, p3.id)).rejects.toMatchObject({ code: "VENDOR_NOT_PAYABLE" });
      const another = await c.approved("V024", "11.00");
      await expect(preparePayment(tx, await c.as("U004"), c.org, another.id)).rejects.toMatchObject({ code: "VENDOR_NOT_PAYABLE" });
    });
  });
});
