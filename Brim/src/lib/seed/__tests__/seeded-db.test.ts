/**
 * Seed check (phase 1 "done when"), against the local database in Brim/.env. Read-only: it
 * checks the database as `npm run db:seed` left it and never reseeds, so it cannot wipe demo
 * state. If it fails on counts after app use, run `npm run db:seed` and try again.
 * Skipped when DATABASE_URL is not set.
 */
import { afterAll, describe, expect, it } from "vitest";
import { verifyChain } from "../../audit/chain";
import { db } from "../../db";
import { sealedFileNames } from "../../pipeline/sealed";

const hasDb = !!process.env.DATABASE_URL?.trim();

describe.runIf(hasDb)("seeded local database", () => {
  const prisma = hasDb ? db() : (undefined as never);
  afterAll(async () => {
    if (hasDb) await prisma.$disconnect();
  });

  const tally = async <T extends Record<string, unknown>>(rows: Promise<T[]>, key: keyof T) =>
    Object.fromEntries((await rows).map((r) => [String(r[key]), (r._count as { _all: number })._all]));

  it("has the Tables row counts", async () => {
    expect({
      users: await prisma.user.count(),
      departments: await prisma.department.count(),
      policyRules: await prisma.policyRule.count(),
      glAccounts: await prisma.glAccount.count(),
      taxCodes: await prisma.taxCode.count(),
      vendors: await prisma.vendor.count(),
      bankChangeRequests: await prisma.bankChangeRequest.count(),
      contracts: await prisma.contract.count(),
      purchaseOrders: await prisma.purchaseOrder.count(),
      historyInvoices: await prisma.invoice.count({ where: { source: "history" } }),
      historyLines: await prisma.invoiceLine.count({ where: { invoice: { source: "history" } } }),
      historyApprovalSteps: await prisma.approvalStep.count({ where: { invoice: { source: "history" } } }),
      historyPayments: await prisma.payment.count({ where: { source: "history" } }),
      bankStatement: await prisma.bankStatementLine.count(),
      cardTransactions: await prisma.cardTransaction.count(),
      fxRates: await prisma.fxRate.count(),
    }).toEqual({
      users: 40,
      departments: 8,
      policyRules: 13,
      glAccounts: 30,
      taxCodes: 6,
      vendors: 56,
      bankChangeRequests: 9,
      contracts: 27,
      purchaseOrders: 52,
      historyInvoices: 426,
      historyLines: 809,
      historyApprovalSteps: 474,
      historyPayments: 415,
      bankStatement: 354,
      cardTransactions: 590,
      fxRates: 306,
    });
  });

  it("has the Tables breakdowns", async () => {
    expect(await tally(prisma.user.groupBy({ by: ["role"], _count: { _all: true } }), "role")).toEqual({
      employee: 28,
      approver: 6,
      ap_clerk: 2,
      controller_admin: 2,
      finance_manager: 1,
      auditor: 1,
    });
    expect(await tally(prisma.vendor.groupBy({ by: ["status"], _count: { _all: true } }), "status")).toEqual({
      active: 52,
      pending_review: 3,
      on_hold: 1,
    });
    const history = { source: "history" };
    expect(
      await tally(prisma.invoice.groupBy({ by: ["status"], where: history, _count: { _all: true } }), "status"),
    ).toEqual({ paid: 394, scheduled: 18, rejected: 12, approved: 2 });
    expect(
      await tally(prisma.invoice.groupBy({ by: ["currency"], where: history, _count: { _all: true } }), "currency"),
    ).toEqual({ CAD: 392, USD: 34 });
    expect(
      await tally(prisma.payment.groupBy({ by: ["method"], where: history, _count: { _all: true } }), "method"),
    ).toEqual({ EFT: 326, CARD: 67, CHEQUE: 22 });
    // `outstanding` in payments.csv is stored as `sent`.
    expect(
      await tally(prisma.payment.groupBy({ by: ["status"], where: history, _count: { _all: true } }), "status"),
    ).toEqual({ settled: 377, sent: 20, scheduled: 18 });
    expect(
      await tally(prisma.approvalStep.groupBy({ by: ["decision"], _count: { _all: true } }), "decision"),
    ).toEqual({ approved: 462, rejected: 12 });
    expect(await tally(prisma.approvalStep.groupBy({ by: ["role"], _count: { _all: true } }), "role")).toEqual({
      dept_manager: 426,
      finance_manager: 48,
    });
  });

  it("has history approvals and payments as audit events, and the whole chain verifies", async () => {
    expect(await prisma.auditEvent.count({ where: { source: "history" } })).toBe(474 + 415);
    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    const result = verifyChain(rows.map((r) => ({ ...r, source: r.source as "app" | "history" })));
    expect(result).toMatchObject({ ok: true, count: rows.length });
  });

  it("holds the 44 unsealed emails and 41 documents and nothing sealed", async () => {
    const sealed = sealedFileNames();
    const emails = await prisma.inboxEmail.findMany({ where: { source: "inbox" }, select: { attachments: true } });
    const docs = await prisma.document.findMany({ select: { fileName: true, url: true } });
    expect(emails).toHaveLength(44);
    expect(docs.filter((d) => d.url?.startsWith("dataset:"))).toHaveLength(41);
    expect(docs.filter((d) => sealed.has(d.fileName))).toEqual([]);
    expect(emails.flatMap((e) => e.attachments as string[]).filter((a) => sealed.has(a))).toEqual([]);
  });
});
