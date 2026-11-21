/**
 * Every workflow service, called directly as each of the six roles: the roles the matrix allows get past
 * the guard (they may still fail on the data), every other role gets 403 FORBIDDEN or READ_ONLY_ROLE.
 * This is the server-side check; the UI hiding things is only a convenience.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { MATRIX, type Action } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import type { Role } from "@/lib/types";
import { harborline, hasLocalDb, rollback } from "@/lib/workflow-test/local-db";
import { decide, reopen, setDelegation, submit } from "../approvals";
import { workflowActor, type WorkflowActor } from "../guard";
import { preparePayment, releasePayment } from "../payments";
import { patchInvoice, resolveFlag } from "../review";
import { decideBankChange, onboardVendor, requestBankChange, setVendorStatus } from "../vendors";

const AS: Record<Role, string> = { employee: "U020", ap_clerk: "U004", approver: "U007", finance_manager: "U003", controller_admin: "U002", auditor: "U006" };
const GUARD = new Set(["FORBIDDEN", "READ_ONLY_ROLE", "FLAG_CLASS"]);

type Call = (tx: Prisma.TransactionClient, a: WorkflowActor, org: string) => Promise<unknown>;
const CASES: Array<[string, Action, Call]> = [
  ["patch invoice", "invoice.edit", (tx, a, org) => patchInvoice(tx, a, org, "AP-00001", 1, {})],
  ["reopen", "invoice.edit", (tx, a, org) => reopen(tx, a, org, "AP-00001", "x")],
  ["submit", "invoice.submit", (tx, a, org) => submit(tx, a, org, "AP-00001", null)],
  ["approve", "invoice.decide", (tx, a, org) => decide(tx, a, { organizationId: org, invoiceId: "AP-00001", decision: "approve", comment: null, ifMatch: null })],
  ["set delegate", "delegate.set_own", (tx, a) => setDelegation(tx, a, { delegateId: null, onLeave: false })],
  ["prepare payment", "payment.prepare", (tx, a, org) => preparePayment(tx, a, org, "AP-00001")],
  ["release payment", "payment.release", (tx, a, org) => releasePayment(tx, a, org, "PAY-00001")],
  ["onboard vendor", "vendor.onboard", (tx, a) => onboardVendor(tx, a, {})],
  ["request bank change", "vendor.bank_change.request", (tx, a) => requestBankChange(tx, a, "V024", {})],
  ["approve vendor", "vendor.approve", (tx, a) => setVendorStatus(tx, a, "V024", "approve", null)],
  ["verify bank change", "vendor.bank_change.verify", (tx, a) => decideBankChange(tx, a, "BC-001", "verify", {})],
];

describe.runIf(hasLocalDb)("workflow services enforce the matrix for every role", () => {
  const prisma = hasLocalDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasLocalDb) await prisma.$disconnect();
  });

  it.each(CASES)("%s", async (_name, action, call) => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      for (const role of Object.keys(AS) as Role[]) {
        const u = await tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: AS[role] } });
        expect(u.role).toBe(role);
        const code = await tx
          .$executeRaw`SAVEPOINT s`
          .then(() => call(tx, workflowActor(u), org))
          .then(() => "OK")
          .catch((e: { code?: string }) => e.code ?? "ERROR");
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT s`;
        const allowed = !!MATRIX[action][role];
        if (allowed) expect(GUARD.has(code), `${role} should pass the guard for ${action}, got ${code}`).toBe(false);
        else expect(GUARD.has(code), `${role} should be refused ${action}, got ${code}`).toBe(true);
      }
    });
  });

  it("resolving a fraud flag is for finance manager and controller; data/policy for the AP clerk", async () => {
    await rollback(prisma, async (tx) => {
      const org = await harborline(tx);
      const inv = await tx.invoice.create({ data: { organizationId: org, id: "TEST-M1", source: "manual", status: "coded" } });
      const fraud = await tx.flag.create({ data: { organizationId: org, invoiceId: inv.id, code: "BANK_MISMATCH", klass: "fraud", effect: "hold", message: "x", evidence: [] } });
      const policy = await tx.flag.create({ data: { organizationId: org, invoiceId: inv.id, code: "PO_CLOSED", klass: "policy", effect: "hold", message: "x", evidence: [] } });
      for (const [flagId, action] of [[fraud.id, "flag.resolve.fraud"], [policy.id, "flag.resolve.data_policy"]] as const) {
        for (const role of Object.keys(AS) as Role[]) {
          const u = await tx.user.findFirstOrThrow({ where: { organizationId: org, externalId: AS[role] } });
          await tx.$executeRaw`SAVEPOINT s`;
          const code = await resolveFlag(tx, workflowActor(u), { organizationId: org, invoiceId: inv.id, flagId, action: "override", reason: "x" })
            .then(() => "OK")
            .catch((e: { code?: string }) => e.code ?? "ERROR");
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT s`;
          expect(GUARD.has(code), `${role} on ${action}: ${code}`).toBe(!MATRIX[action][role]);
        }
      }
    });
  });
});
