/** Flag resolution and PATCH against the local database (seed + ingest), rolled back. */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { workflowActor } from "../guard";
import { processInvoice } from "../process";
import { patchInvoice, resolveFlag } from "../review";

async function setup(tx: Prisma.TransactionClient, fileName: string) {
  const org = await harborline(tx);
  const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId: org, document: { fileName } } });
  await processInvoice(tx, { organizationId: org, invoiceId: inv.id, actor: { type: "system" } });
  const as = async (externalId: string) =>
    workflowActor(await tx.user.findFirstOrThrow({ where: { organizationId: org, externalId } }));
  const flag = (code: string) => tx.flag.findFirstOrThrow({ where: { invoiceId: inv.id, code, status: "open" } });
  const fresh = () => tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  return { org, id: inv.id, as, flag, fresh };
}

describe.runIf(hasLocalDb)("review actions", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it("an AP clerk overrides a policy hold with a reason; the invoice becomes coded", async () => {
    await rollback(prisma, async (tx) => {
      const s = await setup(tx, "keystonerackings-inv-002.pdf");
      const f = await s.flag("PO_REQUIRED_MISSING");
      const clerk = await s.as("U004");
      await expect(resolveFlag(tx, clerk, { organizationId: s.org, invoiceId: s.id, flagId: f.id, action: "override", reason: " " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await resolveFlag(tx, clerk, { organizationId: s.org, invoiceId: s.id, flagId: f.id, action: "override", reason: "PO-2026-0046 confirmed by the requester" });
      expect((await tx.flag.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("overridden");
      expect((await s.fresh()).status).toBe("coded");
      const audit = await tx.auditEvent.findFirstOrThrow({ where: { entityId: f.id, action: "flag.override" } });
      expect(audit.reason).toMatch(/PO-2026-0046/);
    });
  });

  it("refuses a resolution by the wrong class of role, and the auditor", async () => {
    await rollback(prisma, async (tx) => {
      const s = await setup(tx, "harlowsternllp_001468.pdf");
      const dup = await s.flag("DUP_EXACT");
      const input = { organizationId: s.org, invoiceId: s.id, flagId: dup.id, action: "override", reason: "x" };
      await expect(resolveFlag(tx, await s.as("U004"), input)).rejects.toMatchObject({ code: "FLAG_CLASS", status: 403 });
      await expect(resolveFlag(tx, await s.as("U006"), input)).rejects.toMatchObject({ code: "READ_ONLY_ROLE" });
      const k = await setup(tx, "keystonerackings-inv-002.pdf");
      const po = await k.flag("PO_REQUIRED_MISSING");
      await expect(
        resolveFlag(tx, await s.as("U003"), { ...input, invoiceId: k.id, flagId: po.id }),
      ).rejects.toMatchObject({ code: "FLAG_CLASS" });
    });
  });

  it("a finance manager confirming a duplicate sets the invoice to duplicate", async () => {
    await rollback(prisma, async (tx) => {
      const s = await setup(tx, "harlowsternllp_001468.pdf");
      const dup = await s.flag("DUP_EXACT");
      await resolveFlag(tx, await s.as("U003"), { organizationId: s.org, invoiceId: s.id, flagId: dup.id, action: "confirm", reason: "Same number as AP-00389, already paid" });
      expect((await s.fresh()).status).toBe("duplicate");
    });
  });

  it("PATCH needs the current version, and accepts coding with both values audited", async () => {
    await rollback(prisma, async (tx) => {
      const s = await setup(tx, "papertrailoffice_2217.pdf");
      const clerk = await s.as("U004");
      const inv = await s.fresh();
      await expect(patchInvoice(tx, clerk, s.org, s.id, inv.version - 1, { lines: [{ lineNo: 1, accept: true }] })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(patchInvoice(tx, clerk, s.org, s.id, null, {})).rejects.toMatchObject({ code: "VERSION_REQUIRED" });
      const r = await patchInvoice(tx, clerk, s.org, s.id, inv.version, { lines: [{ lineNo: 1, accept: true }] });
      expect(r.version).toBeGreaterThan(inv.version);
      expect((await s.fresh()).lines[0].glFinal).toBe("6210");
      const r2 = await patchInvoice(tx, clerk, s.org, s.id, r.version, { lines: [{ lineNo: 1, glFinal: "6220" }] });
      expect((await s.fresh()).lines[0]).toMatchObject({ glSuggested: "6210", glFinal: "6220" });
      const edit = await tx.auditEvent.findFirstOrThrow({ where: { invoiceId: s.id, action: "invoice.edit" }, orderBy: { seq: "desc" } });
      expect(edit.before).toMatchObject({ "line.1": { glFinal: "6210" } });
      expect(edit.after).toMatchObject({ "line.1": { glFinal: "6220" } });
      await expect(patchInvoice(tx, clerk, s.org, s.id, r2.version, { lines: [{ lineNo: 1, glFinal: "9999" }] })).rejects.toMatchObject({ code: "BAD_FIELD" });
      await expect(patchInvoice(tx, await s.as("U004"), s.org, "AP-00001", 1, {})).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  it("choosing a vendor for an unknown-vendor invoice clears VENDOR_UNKNOWN and survives a re-run", async () => {
    await rollback(prisma, async (tx) => {
      const s = await setup(tx, "Invoice 4443.pdf");
      expect((await s.fresh()).vendorId).toBeNull();
      const v = (await s.fresh()).version;
      await patchInvoice(tx, await s.as("U004"), s.org, s.id, v, { choices: { vendorId: "V003", departmentId: "D01" } });
      await processInvoice(tx, { organizationId: s.org, invoiceId: s.id, actor: { type: "system" } });
      const inv = await s.fresh();
      expect(inv).toMatchObject({ vendorId: "V003", departmentId: "D01" });
      expect(await tx.flag.count({ where: { invoiceId: s.id, code: "VENDOR_UNKNOWN", status: "open" } })).toBe(0);
    });
  });
});
