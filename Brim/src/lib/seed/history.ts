/**
 * History import: the 426 invoices with their lines and taxes, the 474 approvals as
 * approval steps, and the 415 payments (BUILD_PLAN phase 1). Ids are the dataset's ids and
 * every row is marked `source: "history"`.
 *
 * Mapping choices:
 * - Invoice status is kept as the CSV writes it (paid, scheduled, rejected, approved).
 * - Payment status uses the app's vocabulary: `outstanding` (a cheque mailed and not yet
 *   cleared) becomes `sent`; `settled` and `scheduled` stay.
 * - InvoiceTax rows are written for the non-zero GST/HST and PST/QST amounts, coded from the
 *   lines (every history invoice uses one code per column). History has no printed label, so
 *   the label is the code.
 * - An approval step's limit is the approver's approval_limit_cad; history has no delegation.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Dataset, InvoiceLineRow } from "../dataset";
import { invoiceNumberKeys } from "../pipeline/normalize/invoice-number";
import { dateOnly, money, optDateOnly, timestamp } from "./convert";

type Tx = Prisma.TransactionClient | PrismaClient;

const PAYMENT_STATUS: Record<string, string> = { settled: "settled", outstanding: "sent", scheduled: "scheduled" };

export interface HistorySeed {
  invoices: Omit<Prisma.InvoiceCreateManyInput, "organizationId">[];
  lines: Prisma.InvoiceLineCreateManyInput[];
  taxes: Prisma.InvoiceTaxCreateManyInput[];
  steps: Omit<Prisma.ApprovalStepCreateManyInput, "organizationId">[];
  payments: Omit<Prisma.PaymentCreateManyInput, "organizationId">[];
}

function oneCode(
  lines: InvoiceLineRow[],
  pick: (l: InvoiceLineRow) => string | null,
  invoiceId: string,
): string | null {
  const codes = [...new Set(lines.map(pick).filter((c): c is string => c !== null))];
  if (codes.length > 1) throw new Error(`${invoiceId}: lines carry more than one tax code (${codes.join(", ")})`);
  return codes[0] ?? null;
}

export function historySeedRows(
  ds: Pick<Dataset, "invoices" | "invoiceLines" | "approvals" | "payments" | "users" | "vendors">,
): HistorySeed {
  const linesByInvoice = new Map<string, InvoiceLineRow[]>();
  for (const l of ds.invoiceLines) {
    const list = linesByInvoice.get(l.invoiceId) ?? [];
    list.push(l);
    linesByInvoice.set(l.invoiceId, list);
  }
  const limitByUser = new Map(ds.users.map((u) => [u.userId, u.approvalLimitCad]));

  const invoices: Omit<Prisma.InvoiceCreateManyInput, "organizationId">[] = [];
  const taxes: Prisma.InvoiceTaxCreateManyInput[] = [];
  for (const i of ds.invoices) {
    const keys = invoiceNumberKeys(i.vendorInvoiceNumber);
    invoices.push({
      id: i.invoiceId,
      source: "history",
      kind: "invoice",
      docType: "invoice",
      status: i.status,
      vendorId: i.vendorId,
      invoiceNumber: i.vendorInvoiceNumber,
      vendorName: ds.vendors.find((v) => v.vendorId === i.vendorId)?.legalName,
      numberKey: keys.numberKey,
      digitsKey: keys.digitsKey,
      invoiceDate: dateOnly(i.invoiceDate),
      receivedDate: dateOnly(i.receivedDate),
      dueDate: dateOnly(i.dueDate),
      currency: i.currency,
      subtotal: money(i.subtotal),
      gstHstAmount: money(i.gstHstAmount),
      pstQstAmount: money(i.pstQstAmount),
      total: money(i.total),
      fxRateToCad: money(i.fxRateToCad),
      totalCad: money(i.totalCad),
      shipToProvince: i.shipToProvince,
      departmentId: i.departmentId,
      requesterId: i.requesterUserId,
      poId: i.poId,
      contractId: i.contractId,
    });
    const lines = linesByInvoice.get(i.invoiceId) ?? [];
    if (!i.gstHstAmount.isZero()) {
      taxes.push({
        invoiceId: i.invoiceId,
        labelPrinted: oneCode(lines, (l) => l.gstHstCode, i.invoiceId) ?? "GST/HST",
        taxCode: oneCode(lines, (l) => l.gstHstCode, i.invoiceId),
        amount: money(i.gstHstAmount),
      });
    }
    if (!i.pstQstAmount.isZero()) {
      taxes.push({
        invoiceId: i.invoiceId,
        labelPrinted: oneCode(lines, (l) => l.pstQstCode, i.invoiceId) ?? "PST/QST",
        taxCode: oneCode(lines, (l) => l.pstQstCode, i.invoiceId),
        amount: money(i.pstQstAmount),
      });
    }
  }

  const lines: Prisma.InvoiceLineCreateManyInput[] = ds.invoiceLines.map((l) => ({
    invoiceId: l.invoiceId,
    lineNo: l.lineNo,
    description: l.description,
    quantity: money(l.quantity),
    unitPrice: money(l.unitPrice),
    amount: money(l.amount),
    lineType: l.lineType,
    // History is already coded: the account is both the suggestion and the final choice.
    glSuggested: l.glAccount,
    glFinal: l.glAccount,
    departmentSuggested: l.departmentId,
    departmentFinal: l.departmentId,
    gstHstCode: l.gstHstCode,
    pstQstCode: l.pstQstCode,
  }));

  const steps: Omit<Prisma.ApprovalStepCreateManyInput, "organizationId">[] = ds.approvals.map((a) => {
    const limit = limitByUser.get(a.approverUserId);
    if (!limit) throw new Error(`${a.approvalId}: approver ${a.approverUserId} is not in users.csv`);
    return {
      id: a.approvalId,
      invoiceId: a.invoiceId,
      stepNo: a.stepNo,
      role: a.approverRole,
      assignedToId: a.approverUserId,
      onBehalfOfId: null,
      limitCad: money(limit),
      why: { source: "history" },
      decision: a.action,
      decidedById: a.approverUserId,
      decidedAt: timestamp(a.actedAt),
      comment: a.comment,
    };
  });

  const payments: Omit<Prisma.PaymentCreateManyInput, "organizationId">[] = ds.payments.map((p) => {
    const status = PAYMENT_STATUS[p.status];
    if (!status) throw new Error(`${p.paymentId}: unknown payment status ${p.status}`);
    return {
      id: p.paymentId,
      invoiceId: p.invoiceId,
      vendorId: p.vendorId,
      method: p.method,
      scheduledDate: dateOnly(p.scheduledDate),
      paidDate: optDateOnly(p.paidDate),
      currency: p.currency,
      amount: money(p.amount),
      fxRateToCad: money(p.fxRateToCad),
      amountCad: money(p.amountCad),
      discountTaken: money(p.discountTaken),
      reference: p.reference,
      status,
      preparedById: p.preparedBy,
      releasedById: p.releasedBy,
      source: "history",
    };
  });

  return { invoices, lines, taxes, steps, payments };
}

export async function seedHistory(tx: Tx, ds: Dataset, organizationId: string): Promise<Record<string, number>> {
  const rows = historySeedRows(ds);
  return {
    invoices: (await tx.invoice.createMany({ data: rows.invoices.map((row) => ({ ...row, organizationId })) })).count,
    invoiceLines: (await tx.invoiceLine.createMany({ data: rows.lines })).count,
    invoiceTaxes: (await tx.invoiceTax.createMany({ data: rows.taxes })).count,
    approvalSteps: (await tx.approvalStep.createMany({ data: rows.steps.map((row) => ({ ...row, organizationId })) }))
      .count,
    payments: (await tx.payment.createMany({ data: rows.payments.map((row) => ({ ...row, organizationId })) })).count,
  };
}
