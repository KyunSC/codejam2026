import { afterAll, describe, expect, it } from "vitest";
import { verifyChain } from "@/lib/audit/chain";
import { logAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { canTransition, transitionInvoice } from "../transition";

describe("canTransition", () => {
  it.each([
    ["received", "extracted", null, true],
    ["extracted", "coded", null, true],
    ["coded", "pending_approval", null, true],
    ["pending_approval", "approved", null, true],
    ["pending_approval", "rejected", null, true],
    ["rejected", "needs_review", null, true],
    ["approved", "scheduled", null, true],
    ["scheduled", "released", null, true],
    ["released", "paid", null, true],
    ["needs_review", "on_hold", null, true],
    ["on_hold", "coded", "coded", true],
    ["on_hold", "void", "coded", true],
    // refused
    ["on_hold", "approved", "coded", false],
    ["received", "approved", null, false],
    ["needs_review", "pending_approval", null, false],
    ["paid", "void", null, false],
    ["void", "needs_review", null, false],
    ["released", "on_hold", null, false],
    ["coded", "paid", null, false],
    ["nonsense", "coded", null, false],
  ] as const)("%s → %s (held from %s): %s", (from, to, held, ok) => {
    expect(canTransition(from, to, held)).toBe(ok);
  });
});

describe.runIf(hasLocalDb)("transitionInvoice against the local database", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  async function draft(tx: Parameters<Parameters<typeof rollback>[1]>[0], organizationId: string, status = "coded") {
    return tx.invoice.create({ data: { organizationId, source: "manual", status, vendorName: "Test", total: "10.00" } });
  }

  it("moves, bumps the version, and writes a chained audit row", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await draft(tx, org);
      const r = await transitionInvoice(tx, {
        organizationId: org,
        invoiceId: inv.id,
        to: "pending_approval",
        actor: { type: "system" },
        reason: "test",
      });
      expect(r).toMatchObject({ from: "coded", to: "pending_approval", version: 2 });
      const after = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after).toMatchObject({ status: "pending_approval", version: 2 });
      const rows = await tx.auditEvent.findMany({ where: { invoiceId: inv.id }, orderBy: { seq: "asc" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "invoice.status", reason: "test" });
      expect(rows[0].before).toMatchObject({ status: "coded", version: 1 });
      expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("refuses a move that is not in the machine", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await draft(tx, org, "needs_review");
      await expect(
        transitionInvoice(tx, { organizationId: org, invoiceId: inv.id, to: "approved", actor: { type: "system" } }),
      ).rejects.toMatchObject({ code: "INVALID_STATE", status: 409 });
    });
  });

  it("refuses a stale version", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await draft(tx, org);
      const err = await transitionInvoice(tx, {
        organizationId: org,
        invoiceId: inv.id,
        to: "pending_approval",
        actor: { type: "system" },
        expectedVersion: 7,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: "VERSION_CONFLICT" });
    });
  });

  it("remembers heldFrom and returns there when the hold ends", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await draft(tx, org, "approved");
      await transitionInvoice(tx, { organizationId: org, invoiceId: inv.id, to: "on_hold", actor: { type: "system" } });
      expect(await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({
        status: "on_hold",
        heldFrom: "approved",
      });
      await expect(
        transitionInvoice(tx, { organizationId: org, invoiceId: inv.id, to: "coded", actor: { type: "system" } }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
      await transitionInvoice(tx, { organizationId: org, invoiceId: inv.id, to: "approved", actor: { type: "system" } });
      expect(await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({
        status: "approved",
        heldFrom: null,
        version: 3,
      });
    });
  });

  it("refuses data that tries to set status", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await draft(tx, org);
      await expect(
        transitionInvoice(tx, {
          organizationId: org,
          invoiceId: inv.id,
          to: "pending_approval",
          actor: { type: "system" },
          data: { status: "paid" } as never,
        }),
      ).rejects.toThrow(/may not set status/);
    });
  });

  it("logAction continues the organization's hash chain", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const before = await tx.auditEvent.findFirst({
        where: { organizationId: org, hash: { not: null } },
        orderBy: { seq: "desc" },
      });
      await logAction(tx, { organizationId: org, actor: { type: "system" }, action: "test.one", entityType: "test", entityId: "1" });
      await logAction(tx, {
        organizationId: org,
        actor: { type: "system" },
        action: "test.two",
        entityType: "test",
        entityId: "2",
        after: { amount: "1.10", nested: { b: 1, a: [1, 2] } },
      });
      const rows = await tx.auditEvent.findMany({
        where: { organizationId: org, action: { in: ["test.one", "test.two"] } },
        orderBy: { seq: "asc" },
      });
      expect(rows[0].prevHash).toBe(before?.hash ?? "0".repeat(64));
      const r = verifyChain(
        rows.map((x) => ({ ...x, source: x.source as "app" | "history" })),
        rows[0].prevHash!,
      );
      expect(r.ok).toBe(true);
    });
  });
});
