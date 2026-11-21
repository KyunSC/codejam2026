/** Policy editor against the local database, rolled back. */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { applyDraft, type Choices } from "@/lib/workflow/policies";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import type { PolicyRule } from "@/lib/rules/routing/policy";

const choices: Choices = { departments: [{ id: "D01", name: "Ops" }], categories: ["Legal"] };
const p01: PolicyRule = {
  id: "P01", type: "approval", active: true, locked: false,
  when: [{ field: "totalCad", op: "lte", value: 10_000 }], effect: { kind: "requireSteps", steps: ["dept_manager"] },
  sourceText: "", note: "",
};
const p07: PolicyRule = { ...p01, id: "P07", locked: true, when: [], effect: { kind: "invariant", name: "noSelfApproval" } };

describe("applyDraft", () => {
  it("refuses any change to a locked rule, but lets an unchanged draft through", () => {
    expect(() => applyDraft(p07, { active: false }, choices)).toThrow(expect.objectContaining({ code: "LOCKED_RULE" }));
    expect(() => applyDraft(p07, { note: "x" }, choices)).toThrow(expect.objectContaining({ code: "LOCKED_RULE" }));
    expect(applyDraft(p07, { active: true }, choices)).toEqual(p07);
  });

  it("rejects conditions the routing code cannot evaluate (BAD_CONDITION)", () => {
    const bad = (when: unknown[]) => expect(() => applyDraft(p01, { when }, choices)).toThrow(expect.objectContaining({ code: "BAD_CONDITION" }));
    bad([{ field: "colour", op: "in", value: ["red"] }]);
    bad([{ field: "totalCad", op: "in", value: 5 }]);
    bad([{ field: "totalCad", op: "gt", value: "lots" }]);
    bad([{ field: "department", op: "in", value: ["D99"] }]);
    bad([{ field: "flag", op: "in", value: [] }]);
    bad([{ field: "vendor.isNew", op: "eq", value: "yes" }]);
    expect(() => applyDraft(p01, { effect: { kind: "requireSteps", steps: ["janitor"] } }, choices)).toThrow(expect.objectContaining({ code: "BAD_CONDITION" }));
    expect(() => applyDraft(p01, { effect: { kind: "hold", flag: "PO_CLOSED" } }, choices)).toThrow(expect.objectContaining({ code: "BAD_CONDITION" }));
  });

  it("normalises steps into rank order and keeps valid conditions", () => {
    const r = applyDraft(p01, { when: [{ field: "department", op: "in", value: ["D01", "D01"] }], effect: { kind: "requireSteps", steps: ["cfo", "dept_manager"] } }, choices);
    expect(r.when).toEqual([{ field: "department", op: "in", value: ["D01"] }]);
    expect(r.effect).toEqual({ kind: "requireSteps", steps: ["dept_manager", "cfo"] });
  });
});

describe.runIf(hasLocalDb)("policies against the DB", () => {
  let prisma: PrismaClient;
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });
  const user = (tx: Prisma.TransactionClient, org: string, id: string) => tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: id } });

  it("controller edits and the edit is audited; auditor reads only; locked rules stay locked", async () => {
    prisma = (await import("@/lib/db")).db();
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const { listPolicies, updatePolicy } = await import("../policies");
      const { workflowActor } = await import("../guard");
      const controller = workflowActor(await user(tx, org, "U002"));
      const auditor = workflowActor(await user(tx, org, "U006"));

      const asAuditor = await listPolicies(tx, auditor.user);
      expect(asAuditor.rules.map((r) => r.id)).toHaveLength(13);
      expect(asAuditor.canEdit).toBe(false);
      expect(asAuditor.rules.filter((r) => r.locked).map((r) => r.id)).toEqual(["P07", "P08", "P11"]);
      expect(asAuditor.options.categories).toContain("Legal");
      await expect(listPolicies(tx, (await user(tx, org, "U004")))).rejects.toMatchObject({ code: "FORBIDDEN" });

      await expect(updatePolicy(tx, auditor, org, "P01", { active: false })).rejects.toMatchObject({ status: 403 });
      await expect(updatePolicy(tx, controller, org, "P11", { active: false })).rejects.toMatchObject({ code: "LOCKED_RULE" });
      await expect(updatePolicy(tx, controller, org, "P06", { when: [{ field: "vendor.category", op: "in", value: ["Nope"] }] })).rejects.toMatchObject({ code: "BAD_CONDITION" });

      const res = await updatePolicy(tx, controller, org, "P06", { when: [{ field: "vendor.category", op: "in", value: ["Legal", "Consulting"] }] });
      expect(res.changed).toBe(true);
      const row = await tx.policyRule.findUniqueOrThrow({ where: { organizationId_id: { organizationId: org, id: "P06" } } });
      expect(row.when).toEqual([{ field: "vendor.category", op: "in", value: ["Legal", "Consulting"] }]);
      expect(row.updatedById).toBe(controller.user.id);
      const audit = await tx.auditEvent.findFirstOrThrow({ where: { organizationId: org, action: "policy.update", entityId: "P06" }, orderBy: { seq: "desc" } });
      expect(audit.before).toMatchObject({ when: [{ value: ["Legal"] }] });
      expect(audit.after).toMatchObject({ when: [{ value: ["Legal", "Consulting"] }] });
      // An unchanged draft writes nothing.
      expect((await updatePolicy(tx, controller, org, "P06", { active: true })).changed).toBe(false);
    });
  }, 60_000);

  it("Try on an invoice: lowering the dept-manager threshold adds a finance manager step to a $7,024.81 invoice", async () => {
    prisma = (await import("@/lib/db")).db();
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const { previewPolicies } = await import("../policies");
      const controller = await user(tx, org, "U002");
      const out = await previewPolicies(tx, controller, {
        invoiceId: "AP-00004",
        drafts: {
          P01: { when: [{ field: "totalCad", op: "lte", value: 5000 }] },
          P02: { when: [{ field: "totalCad", op: "gt", value: 5000 }] },
        },
      });
      expect(out.changedRules).toEqual(["P01", "P02"]);
      expect(out.before.route.steps.map((s) => s.role)).toEqual(["dept_manager"]);
      expect(out.after.route.steps.map((s) => s.role)).toEqual(["dept_manager", "finance_manager"]);
      expect(out.after.route.steps[1].ruleIds).toContain("P02");
      // Nothing was saved.
      const p01 = await tx.policyRule.findUniqueOrThrow({ where: { organizationId_id: { organizationId: org, id: "P01" } } });
      expect(p01.when).toEqual([{ field: "totalCad", op: "lte", value: 10_000 }]);
      await expect(previewPolicies(tx, controller, { invoiceId: "AP-00004", drafts: { P08: { active: false } } })).rejects.toMatchObject({ code: "LOCKED_RULE" });
    });
  }, 60_000);
});
