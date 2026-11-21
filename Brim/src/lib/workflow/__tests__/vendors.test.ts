/** Vendors and bank changes against the local database, rolled back. */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDataset } from "@/lib/dataset";
import { replayHistory } from "@/lib/rules/replay";
import { today } from "@/lib/today";
import { harborline, hasLocalDb } from "@/lib/workflow-test/local-db";

class Rollback extends Error {}

/** Runs `fn` in a rolled-back transaction with db() pointing at it (the read functions use db()). */
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

describe.runIf(hasLocalDb)("vendors", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });
  const setup = async (tx: Prisma.TransactionClient) => {
    const org = await harborline(tx);
    const { workflowActor } = await import("../guard");
    const user = (id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });
    return { org, user, as: async (id: string) => workflowActor(await user(id)) };
  };

  it("V004 stays held until a second person verifies BC-009 with a callback", async () => {
    prisma = (await import("@/lib/db")).db();
    await withTx(prisma, async (tx) => {
      const s = await setup(tx);
      const { decideBankChange } = await import("../vendors");
      const { flagOpenHistory, paymentBlockers } = await import("../payments");
      await flagOpenHistory(tx, s.org, replayHistory(loadDataset(), today()).results);
      expect((await paymentBlockers(tx, s.org, "AP-00426", "prepare")).map((b) => b.code)).toEqual(["OPEN_HOLD", "BANK_CHANGE_UNVERIFIED"]);
      const bc = await tx.bankChangeRequest.findFirstOrThrow({ where: { organizationId: s.org, id: "BC-009" } });
      const requester = await tx.user.findUniqueOrThrow({ where: { id: bc.requestedById } });
      // Make the requester someone who may verify, to show FOUR_EYES; then a second person verifies.
      await tx.bankChangeRequest.update({ where: { organizationId_id: { organizationId: s.org, id: "BC-009" } }, data: { requestedById: (await s.user("U003")).id } });
      await expect(decideBankChange(tx, await s.as("U003"), "BC-009", "verify", { calledBack: true, note: "x" })).rejects.toMatchObject({ code: "FOUR_EYES" });
      await expect(decideBankChange(tx, await s.as("U002"), "BC-009", "verify", { calledBack: false, note: "x" })).rejects.toMatchObject({ code: "CALLBACK_REQUIRED" });
      await expect(decideBankChange(tx, await s.as("U004"), "BC-009", "verify", { calledBack: true, note: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const done = await decideBankChange(tx, await s.as("U002"), "BC-009", "verify", { calledBack: true, note: "Called 604-555-0144 on file; J. Tran confirmed account ending 9679" });
      expect(done).toMatchObject({ status: "verified", verifiedByCallback: true });
      expect(await paymentBlockers(tx, s.org, "AP-00426", "prepare")).toEqual([]);
      expect(requester.role).toBeDefined();
    });
  }, 60_000);

  it("rejecting BC-009, whose account is already on file, puts V004 on hold", async () => {
    await withTx(prisma, async (tx) => {
      const s = await setup(tx);
      const { decideBankChange } = await import("../vendors");
      await expect(decideBankChange(tx, await s.as("U003"), "BC-009", "reject", { note: "" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await decideBankChange(tx, await s.as("U003"), "BC-009", "reject", { note: "Vendor says they never asked" });
      expect((await tx.vendor.findFirstOrThrow({ where: { organizationId: s.org, id: "V004" } })).status).toBe("on_hold");
    });
  });

  it("a new bank change does not touch the live account until verified", async () => {
    await withTx(prisma, async (tx) => {
      const s = await setup(tx);
      const { decideBankChange, requestBankChange } = await import("../vendors");
      const before = await tx.vendorBankAccount.findFirstOrThrow({ where: { organizationId: s.org, vendorId: "V024", validTo: null } });
      const req = await requestBankChange(tx, await s.as("U004"), "V024", { institution: "003", transit: "12345", account: "123456789", channel: "email_request" });
      expect(req).toMatchObject({ status: "pending", oldLast4: before.last4, newLast4: "6789" });
      expect((await tx.vendorBankAccount.findFirstOrThrow({ where: { organizationId: s.org, vendorId: "V024", validTo: null } })).id).toBe(before.id);
      await decideBankChange(tx, await s.as("U003"), req.id, "verify", { calledBack: true, note: "Called the number on file" });
      const live = await tx.vendorBankAccount.findFirstOrThrow({ where: { organizationId: s.org, vendorId: "V024", validTo: null } });
      expect(live).toMatchObject({ account: "123456789", changeRequestId: req.id });
    });
  });

  it("onboarding: pending_review, VENDOR_EXISTS, approved only by a second person; hold and release with FOUR_EYES", async () => {
    await withTx(prisma, async (tx) => {
      const s = await setup(tx);
      const { onboardVendor, setVendorStatus } = await import("../vendors");
      const clerk = await s.as("U004");
      const base = { legalName: "Northwind Test Ltd", category: "Office Supplies", defaultGlAccount: "6210", apContactEmail: "ap@northwind.example" };
      const v = await onboardVendor(tx, clerk, { ...base, account: "11112222" });
      expect(v).toMatchObject({ id: "V057", status: "pending_review" });
      const v001 = await tx.vendor.findFirstOrThrow({ where: { organizationId: s.org, id: "V001" } });
      await expect(onboardVendor(tx, clerk, { ...base, gstHstNumber: v001.gstHstNumber })).rejects.toMatchObject({ code: "VENDOR_EXISTS" });
      await expect(setVendorStatus(tx, clerk, v.id, "approve", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await tx.vendor.update({ where: { organizationId_id: { organizationId: s.org, id: v.id } }, data: { createdById: (await s.user("U003")).id } });
      await expect(setVendorStatus(tx, await s.as("U003"), v.id, "approve", null)).rejects.toMatchObject({ code: "FOUR_EYES" });
      await setVendorStatus(tx, await s.as("U002"), v.id, "approve", null);
      await setVendorStatus(tx, await s.as("U003"), v.id, "hold", "Lookalike of an existing vendor");
      await expect(setVendorStatus(tx, await s.as("U003"), v.id, "release-hold", "checked")).rejects.toMatchObject({ code: "FOUR_EYES" });
      await setVendorStatus(tx, await s.as("U002"), v.id, "release-hold", "Checked the tax number with the vendor");
      expect((await tx.vendor.findFirstOrThrow({ where: { organizationId: s.org, id: v.id } })).status).toBe("active");
    });
  });

  it("bank details are masked by role; the detail shows AP invoices and card charges together", async () => {
    await withTx(prisma, async (tx) => {
      const s = await setup(tx);
      const { getVendor, listVendors } = await import("../vendors");
      const view = async (id: string) => (await listVendors(await s.user(id))).find((v) => v.id === "V024") as Record<string, unknown>;
      expect(Object.keys(await view("U020"))).toEqual(["id", "legalName", "category", "status"]); // employee: names
      expect((await view("U007")).bank).toBeUndefined(); // approver: no bank
      expect((await view("U004")).bank).toMatchObject({ last4: expect.stringMatching(/^•••• \d{4}$/) }); // clerk
      expect(((await view("U004")).bank as Record<string, unknown>).account).toBeUndefined();
      const d = await getVendor(await s.user("U003"), "V015");
      expect(d.invoices.length).toBeGreaterThan(0);
      expect(d.cardCharges.length).toBeGreaterThan(0);
    });
  });
});
