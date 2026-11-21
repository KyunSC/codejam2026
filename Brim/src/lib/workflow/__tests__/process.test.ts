/**
 * processInvoice against the local database (after seed + ingest-inbox --run), rolled back.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { needsReview, processInvoice } from "../process";

describe("needsReview", () => {
  it.each([
    [[], [{ glAccount: "6210" }], false],
    [[{ effect: "info" }, { effect: "route" }], [{ glAccount: "6210" }], false],
    [[{ effect: "hold" }], [{ glAccount: "6210" }], true],
    [[], [{ glAccount: null }], true],
  ] as const)("flags %j, lines %j → %s", (flags, lines, want) => {
    expect(needsReview(flags, lines)).toBe(want);
  });
});

async function byFile(tx: Prisma.TransactionClient, organizationId: string, fileName: string) {
  return tx.invoice.findFirstOrThrow({ where: { organizationId, document: { fileName } }, select: { id: true } });
}

const hasDrafts = hasLocalDb;

describe.runIf(hasDrafts)("processInvoice on the local inbox drafts", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it("raises DUP_EXACT on the reused Harlow & Stern number and holds it for review", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const { id } = await byFile(tx, org, "harlowsternllp_001468.pdf");
      const r = await processInvoice(tx, { organizationId: org, invoiceId: id, actor: { type: "system" } });
      expect(r.status).toBe("needs_review");
      const dup = r.flags.find((f) => f.code === "DUP_EXACT");
      expect(dup?.related?.invoiceIds).toContain("AP-00389");
      const stored = await tx.flag.findMany({ where: { invoiceId: id, status: "open" } });
      expect(stored.map((f) => f.code)).toContain("DUP_EXACT");
      expect(stored.find((f) => f.code === "DUP_EXACT")!.evidence).not.toEqual([]);
    });
  });

  it("codes a clean invoice with a reason on every line and moves it to coded", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const { id } = await byFile(tx, org, "papertrailoffice_2217.pdf");
      const r = await processInvoice(tx, { organizationId: org, invoiceId: id, actor: { type: "system" } });
      expect(r.status).toBe("coded");
      const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id } });
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l.glSuggested).toBe("6210");
        expect((l.reason as { account: string }).account).toMatch(/past lines coded 6210/);
      }
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
      expect(inv).toMatchObject({ vendorId: "V024", status: "coded" });
      const audit = await tx.auditEvent.findFirst({ where: { invoiceId: id, action: "invoice.checked" }, orderBy: { seq: "desc" } });
      expect(audit?.hash).toBeTruthy();
    });
  });

  it("keeps a flag a person overrode, and fixes one that no longer fires", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const { id } = await byFile(tx, org, "ironwoodpalletco-inv-048.pdf");
      await processInvoice(tx, { organizationId: org, invoiceId: id, actor: { type: "system" } });
      const po = await tx.flag.findFirstOrThrow({ where: { invoiceId: id, code: "PO_REQUIRED_MISSING" } });
      await tx.flag.update({ where: { id: po.id }, data: { status: "overridden", resolutionNote: "test" } });
      const ghost = await tx.flag.create({
        data: { organizationId: org, invoiceId: id, code: "ARITHMETIC_TOTAL", klass: "data", effect: "hold", message: "x", evidence: [] },
      });
      const r = await processInvoice(tx, { organizationId: org, invoiceId: id, actor: { type: "system" } });
      expect((await tx.flag.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("overridden");
      expect((await tx.flag.findUniqueOrThrow({ where: { id: ghost.id } })).status).toBe("fixed");
      // TAX_WRONG_FOR_PROVINCE (Ontario, no HST) still holds it.
      expect(r.status).toBe("needs_review");
      expect(await tx.flag.count({ where: { invoiceId: id, code: "PO_REQUIRED_MISSING" } })).toBe(1);
    });
  });

  it("refuses an invoice that is not in a processable state", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      await expect(
        processInvoice(tx, { organizationId: org, invoiceId: "AP-00001", actor: { type: "system" } }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });
});
