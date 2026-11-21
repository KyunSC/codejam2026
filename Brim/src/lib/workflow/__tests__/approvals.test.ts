/**
 * Approvals against the local database (seed + ingest), rolled back: BUILD_PLAN's five worked
 * examples end to end, the submit refusals, the decision invariants and delegation.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { decide, routePreview, setDelegation, submit } from "../approvals";
import { workflowActor } from "../guard";
import { patchInvoice } from "../review";

type Tx = Prisma.TransactionClient;

async function ctx(tx: Tx) {
  const org = await harborline(tx);
  const as = async (externalId: string) => workflowActor(await tx.user.findFirstOrThrow({ where: { organizationId: org, externalId } }));
  let n = 0;
  /** A coded manual invoice with one coded line and no flags. */
  const invoice = async (o: { vendorId: string; departmentId: string; totalCad: string; requesterId?: string }) => {
    n += 1;
    return tx.invoice.create({
      data: {
        organizationId: org,
        id: `TEST-${n}`,
        source: "manual",
        status: "coded",
        vendorId: o.vendorId,
        departmentId: o.departmentId,
        requesterId: o.requesterId ?? null,
        currency: "CAD",
        total: o.totalCad,
        totalCad: o.totalCad,
        lines: { create: [{ lineNo: 1, description: "Services", amount: o.totalCad, glSuggested: "6210", glFinal: "6210" }] },
      },
    });
  };
  const decideAs = async (who: string, invoiceId: string, decision: "approve" | "reject" = "approve", comment: string | null = null) =>
    decide(tx, await as(who), { organizationId: org, invoiceId, decision, comment, ifMatch: null });
  const steps = (invoiceId: string) => tx.approvalStep.findMany({ where: { invoiceId }, orderBy: { stepNo: "asc" } });
  return { org, as, invoice, decideAs, steps };
}

const chain = (s: Array<{ assignedToId: string; onBehalfOfId: string | null }>) =>
  s.map((x) => (x.onBehalfOfId ? `${x.assignedToId} for ${x.onBehalfOfId}` : x.assignedToId));

describe.runIf(hasLocalDb)("approvals: BUILD_PLAN worked examples", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it("1. D01 invoice, $4,743.80 → U007; release U003, U002 or U001", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D01", totalCad: "4743.80" });
      const r = await submit(tx, await c.as("U004"), c.org, inv.id, null);
      expect(chain(await c.steps(inv.id))).toEqual(["U007"]);
      expect(r.release.releaserIds).toEqual(["U003", "U002", "U001"]);
      await c.decideAs("U007", inv.id);
      expect((await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("approved");
    });
  });

  it("2. D07 rent invoice, $18,758.00 (V036) → U003 for U012, then U002; release U001 only", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await tx.invoice.findFirstOrThrow({ where: { organizationId: c.org, document: { fileName: "Invoice 002935.pdf" } } });
      expect(inv.status).toBe("coded");
      const lines = await tx.invoiceLine.findMany({ where: { invoiceId: inv.id } });
      const clerk = await c.as("U004");
      const p = await patchInvoice(tx, clerk, c.org, inv.id, inv.version, { lines: lines.map((l) => ({ lineNo: l.lineNo, accept: true })) });
      const preview = await routePreview(tx, c.org, inv.id);
      expect(preview.release.releaserIds).toEqual(["U001"]);
      await submit(tx, clerk, c.org, inv.id, p.version);
      expect(chain(await c.steps(inv.id))).toEqual(["U003 for U012", "U002"]);
      // U012 is on leave; the step is U003's to decide, as delegate.
      await expect(c.decideAs("U012", inv.id)).rejects.toMatchObject({ code: "NOT_YOUR_STEP" });
      await c.decideAs("U003", inv.id);
      await expect(c.decideAs("U003", inv.id)).rejects.toMatchObject({ code: "NOT_YOUR_STEP" });
      await c.decideAs("U002", inv.id);
      expect((await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("approved");
      const s = await c.steps(inv.id);
      expect(s.map((x) => [x.decision, x.decidedById, x.onBehalfOfId])).toEqual([
        ["approved", "U003", "U012"],
        ["approved", "U002", null],
      ]);
      const u012 = await tx.user.findFirstOrThrow({ where: { organizationId: c.org, externalId: "U012" } });
      const audit = await tx.auditEvent.findFirstOrThrow({ where: { invoiceId: inv.id, action: "invoice.approve" }, orderBy: { seq: "asc" } });
      expect(audit.onBehalfOfId).toBe(u012.id);
    });
  });

  it("3. Legal invoice from an established vendor, $339.52, D08 → U001; U003 (P06); release U002 only", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V026", departmentId: "D08", totalCad: "339.52" });
      const r = await submit(tx, await c.as("U004"), c.org, inv.id, null);
      const s = await c.steps(inv.id);
      expect(chain(s)).toEqual(["U001", "U003"]);
      expect((s[1].why as { ruleIds: string[] }).ruleIds).toContain("P06");
      expect(r.release.releaserIds).toEqual(["U002"]);
    });
  });

  it("4. Requested by U010, IT, $2,700 → U001 (P07); release U003 or U002; U010 cannot approve", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D05", totalCad: "2700.00", requesterId: "U010" });
      const r = await submit(tx, await c.as("U004"), c.org, inv.id, null);
      const s = await c.steps(inv.id);
      expect(chain(s)).toEqual(["U001"]);
      expect((s[0].why as { replacements: string[] }).replacements[0]).toMatch(/U010 .* requested this invoice \(P07\) → manager U001/);
      expect(r.release.releaserIds).toEqual(["U003", "U002"]);
      // Even if the step were handed to the requester, they could not decide it.
      await tx.approvalStep.update({ where: { organizationId_id: { organizationId: c.org, id: s[0].id } }, data: { assignedToId: "U010" } });
      await expect(c.decideAs("U010", inv.id)).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    });
  });

  it("5. D04 invoice, $60,000 → U002; U003; U001; nobody may release, so submit refuses with the reason", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D04", totalCad: "60000.00" });
      const p = await routePreview(tx, c.org, inv.id);
      expect(chain(p.route.steps.map((x) => ({ assignedToId: x.assignedToId!, onBehalfOfId: x.onBehalfOfId })))).toEqual(["U002", "U003", "U001"]);
      await expect(submit(tx, await c.as("U004"), c.org, inv.id, null)).rejects.toMatchObject({
        code: "STEP_UNRESOLVABLE",
        message: expect.stringMatching(/Nobody may release \$60,000.00/),
      });
    });
  });
});

describe.runIf(hasLocalDb)("approvals: refusals and delegation", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it("submit refuses open hold flags, missing coding and a stale version", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const clerk = await c.as("U004");
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D01", totalCad: "100.00" });
      await expect(submit(tx, clerk, c.org, inv.id, inv.version + 1)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await tx.invoiceLine.updateMany({ where: { invoiceId: inv.id }, data: { glFinal: null } });
      await expect(submit(tx, clerk, c.org, inv.id, null)).rejects.toMatchObject({ code: "CODING_INCOMPLETE" });
      await tx.invoiceLine.updateMany({ where: { invoiceId: inv.id }, data: { glFinal: "6210" } });
      await tx.flag.create({ data: { organizationId: c.org, invoiceId: inv.id, code: "BANK_MISMATCH", klass: "fraud", effect: "hold", message: "x", evidence: [] } });
      await expect(submit(tx, clerk, c.org, inv.id, null)).rejects.toMatchObject({ code: "OPEN_FLAGS" });
    });
  });

  it("an overridden policy flag adds a finance manager step", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D01", totalCad: "100.00" });
      await tx.flag.create({ data: { organizationId: c.org, invoiceId: inv.id, code: "PO_REQUIRED_MISSING", klass: "policy", effect: "hold", status: "overridden", message: "x", evidence: [] } });
      await submit(tx, await c.as("U004"), c.org, inv.id, null);
      expect(chain(await c.steps(inv.id))).toEqual(["U007", "U003"]);
    });
  });

  it("a decision with a stale version is refused; a rejection needs a reason and ends the chain", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D01", totalCad: "100.00" });
      await submit(tx, await c.as("U004"), c.org, inv.id, null);
      await expect(
        decide(tx, await c.as("U007"), { organizationId: c.org, invoiceId: inv.id, decision: "approve", comment: null, ifMatch: 1 }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(c.decideAs("U007", inv.id, "reject")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await c.decideAs("U007", inv.id, "reject", "Goods not received");
      expect((await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("rejected");
    });
  });

  it("an approver who goes on leave after submit: the delegate decides, recorded on their behalf", async () => {
    await rollback(prisma, async (tx) => {
      const c = await ctx(tx);
      const inv = await c.invoice({ vendorId: "V024", departmentId: "D01", totalCad: "100.00" });
      await submit(tx, await c.as("U004"), c.org, inv.id, null);
      await expect(setDelegation(tx, await c.as("U007"), { delegateId: "U015", onLeave: true })).rejects.toMatchObject({ code: "DELEGATE_INVALID" });
      await setDelegation(tx, await c.as("U007"), { delegateId: "U008", onLeave: true });
      await c.decideAs("U008", inv.id);
      const [s] = await c.steps(inv.id);
      expect([s.decidedById, s.onBehalfOfId]).toEqual(["U008", "U007"]);
    });
  });
});
