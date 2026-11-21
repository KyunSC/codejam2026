/** Audit pack, CSV export and chain verification. Posting is pure; the rest runs on the local DB, rolled back. */
import Decimal from "decimal.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { harborline, hasLocalDb } from "@/lib/workflow-test/local-db";
import { posting } from "../audit-pack";

const D = (v: string) => new Decimal(v);

describe("posting", () => {
  it("BC goods and services: PST goes into the goods line's cost, GST to 1160, total to 2100", () => {
    const out = posting(
      { total: D("2247.00"), currency: "CAD" },
      [
        { lineNo: 1, account: "5030", amount: D("1000.00"), lineType: "goods" },
        { lineNo: 2, account: "6330", amount: D("1100.00"), lineType: "services" },
      ],
      [
        { taxCode: "GST5", amount: D("105.00") },
        { taxCode: "PST7_BC", amount: D("70.00") },
      ],
      { "5030": "Racking", "1160": "GST/HST receivable", "2100": "Accounts payable" },
    );
    expect(out.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["5030", "1070.00", null],
      ["6330", "1100.00", null],
      ["1160", "105.00", null],
      ["2100", null, "2247.00"],
    ]);
  });

  it("Quebec: QST to 1165; debits equal the credit", () => {
    const out = posting(
      { total: D("1149.75"), currency: "CAD" },
      [{ lineNo: 1, account: "6330", amount: D("1000.00"), lineType: "services" }],
      [
        { taxCode: "GST5", amount: D("50.00") },
        { taxCode: "QST9975", amount: D("99.75") },
      ],
      {},
    );
    const debit = out.reduce((s, l) => s.plus(l.debit ?? 0), D("0"));
    expect(out.map((l) => l.account)).toEqual(["6330", "1160", "1165", "2100"]);
    expect(debit.toFixed(2)).toBe("1149.75");
  });
});

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

describe.runIf(hasLocalDb)("audit trail on the local database", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    vi.doUnmock("@/lib/db");
    if (prisma) await prisma.$disconnect();
  });
  const user = async (tx: Prisma.TransactionClient, id: string) =>
    tx.user.findFirstOrThrow({ where: { organizationId: await harborline(tx), externalId: id } });

  it("opens a complete pack for a history payment", async () => {
    prisma = (await import("@/lib/db")).db();
    await withTx(prisma, async (tx) => {
      const { auditPack } = await import("../audit-pack");
      const pack = await auditPack(await user(tx, "U006"), "PAY-00096");
      expect(pack.invoice.id).toBe("AP-00100");
      expect(pack.approvals.length).toBeGreaterThan(0);
      expect(pack.approvals[0].decision).toBe("approved");
      expect(pack.payment.releasedBy?.id).toMatch(/^U00\d$/);
      expect(pack.events.map((e) => e.action)).toEqual(expect.arrayContaining(["invoice.approve", "payment.release"]));
      expect(pack.bank).not.toBeNull();
      expect(pack.posting.at(-1)).toMatchObject({ account: "2100" });
      await expect(auditPack(await user(tx, "U004"), "PAY-00096")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("opens a pack for a payment made in the app, with the release snapshot", async () => {
    await withTx(prisma, async (tx) => {
      const { auditPack } = await import("../audit-pack");
      const { preparePayment, releasePayment } = await import("../payments");
      const { workflowActor } = await import("../guard");
      const org = await harborline(tx);
      const inv = await tx.invoice.create({
        data: { organizationId: org, id: "TEST-A1", source: "manual", status: "approved", vendorId: "V024", currency: "CAD", total: "50.00", totalCad: "50.00", fxRateToCad: "1", dueDate: new Date("2026-11-20T00:00:00Z") },
      });
      const p = await preparePayment(tx, workflowActor(await user(tx, "U004")), org, inv.id);
      await releasePayment(tx, workflowActor(await user(tx, "U003")), org, p.id);
      const pack = await auditPack(await user(tx, "U002"), p.id);
      expect(pack.bankSource).toBe("snapshot taken at release");
      expect(pack.events.map((e) => e.action)).toEqual(expect.arrayContaining(["payment.prepare", "payment.release", "invoice.scheduled"]));
      expect(pack.payment.releasedBy?.id).toBe("U003");
    });
  });

  it("CSV export is for controller and auditor only, and escapes JSON", async () => {
    await withTx(prisma, async (tx) => {
      const { auditCsv } = await import("../audit-pack");
      await expect(auditCsv(await user(tx, "U004"), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      const csv = await auditCsv(await user(tx, "U006"), { invoiceId: "AP-00100" });
      const lines = csv.trim().split("\n");
      expect(lines[0].startsWith("seq,at,source,actorType")).toBe(true);
      expect(lines.length).toBeGreaterThan(1);
      expect(csv).toContain('""');
    });
  });

  it("verify chain passes, and names the first row after a tampering", async () => {
    await withTx(prisma, async (tx) => {
      const { verifyAuditChain } = await import("../audit-pack");
      const auditor = await user(tx, "U006");
      const ok = await verifyAuditChain(auditor);
      expect(ok.ok).toBe(true);
      const victim = await tx.auditEvent.findFirstOrThrow({ where: { organizationId: auditor.organizationId, source: "history" }, orderBy: { seq: "asc" }, skip: 10 });
      // Test only, inside a rolled-back transaction: the app has no update path for audit rows.
      await tx.auditEvent.update({ where: { seq: victim.seq }, data: { reason: "edited" } });
      const bad = await verifyAuditChain(auditor);
      expect(bad).toMatchObject({ ok: false, firstBad: { seq: victim.seq.toString() } });
    });
  });
});
