/**
 * Reference tables, one to one from the CSVs (BUILD_PLAN "Data model"). Ids are the
 * dataset's ids. The mapping functions are pure so they can be tested without a database.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Dataset } from "../dataset";
import { policyRulesFrom } from "../policy/seed-rules";
import { dateOnly, money, optDateOnly, optMoney } from "./convert";

type Tx = Prisma.TransactionClient | PrismaClient;

export function userRows(ds: Pick<Dataset, "users">): Omit<Prisma.UserCreateManyInput, "organizationId">[] {
  return ds.users.map((u) => ({
    id: u.userId,
    fullName: u.fullName,
    email: u.email,
    title: u.title,
    departmentId: u.departmentId,
    managerId: u.managerId,
    role: u.role,
    approvalLimitCad: money(u.approvalLimitCad),
    workProvince: u.workProvince,
    status: u.status,
    statusSince: optDateOnly(u.statusSince),
    delegateId: u.delegateUserId,
    hireDate: dateOnly(u.hireDate),
  }));
}

export function departmentRows(
  ds: Pick<Dataset, "departments">,
): Omit<Prisma.DepartmentCreateManyInput, "organizationId">[] {
  return ds.departments.map((d) => ({
    id: d.departmentId,
    name: d.name,
    costCentre: d.costCentre,
    annualBudgetCad: money(d.annualBudgetCad),
    managerUserId: d.managerUserId,
  }));
}

export function glAccountRows(
  ds: Pick<Dataset, "glAccounts">,
): Omit<Prisma.GlAccountCreateManyInput, "organizationId">[] {
  return ds.glAccounts.map((g) => ({ id: g.accountNumber, name: g.name, accountType: g.accountType, notes: g.notes }));
}

export function taxCodeRows(ds: Pick<Dataset, "taxCodes">): Omit<Prisma.TaxCodeCreateManyInput, "organizationId">[] {
  return ds.taxCodes.map((t) => ({
    id: t.code,
    description: t.description,
    rate: money(t.rate),
    appliesTo: t.appliesTo,
    recoverable: t.recoverable,
    glAccount: t.glAccount,
  }));
}

/** Bank details are not stored on the vendor: they go to VendorBankAccount (seed item 1.5). */
export function vendorRows(ds: Pick<Dataset, "vendors">): Omit<Prisma.VendorCreateManyInput, "organizationId">[] {
  return ds.vendors.map((v) => ({
    id: v.vendorId,
    legalName: v.legalName,
    category: v.category,
    defaultGlAccount: v.defaultGlAccount,
    address: v.address,
    provinceOrState: v.provinceOrState,
    country: v.country,
    gstHstNumber: v.gstHstNumber,
    qstNumber: v.qstNumber,
    paymentTermsDays: v.paymentTermsDays,
    earlyPayDiscount: v.earlyPayDiscount,
    preferredPaymentMethod: v.preferredPaymentMethod,
    acceptsCardPayment: v.acceptsCardPayment,
    apContactEmail: v.apContactEmail,
    requiresPo: v.requiresPo,
    status: v.status,
    onboardedAt: dateOnly(v.onboardedAt),
  }));
}

export function contractRows(ds: Pick<Dataset, "contracts">): Omit<Prisma.ContractCreateManyInput, "organizationId">[] {
  return ds.contracts.map((c) => ({
    id: c.contractId,
    vendorId: c.vendorId,
    description: c.description,
    billingType: c.billingType,
    monthlyFee: optMoney(c.monthlyFee),
    currency: c.currency,
    hourlyRateCap: optMoney(c.hourlyRateCap),
    fuelSurchargeCapPct: optMoney(c.fuelSurchargeCapPct),
    notToExceedMonthly: optMoney(c.notToExceedMonthly),
    startDate: dateOnly(c.startDate),
    endDate: dateOnly(c.endDate),
    autoRenew: c.autoRenew,
    status: c.status,
  }));
}

export function purchaseOrderRows(
  ds: Pick<Dataset, "purchaseOrders">,
): Omit<Prisma.PurchaseOrderCreateManyInput, "organizationId">[] {
  return ds.purchaseOrders.map((p) => ({
    id: p.poId,
    vendorId: p.vendorId,
    departmentId: p.departmentId,
    requesterUserId: p.requesterUserId,
    issueDate: dateOnly(p.issueDate),
    description: p.description,
    totalAmount: money(p.totalAmount),
    currency: p.currency,
    status: p.status,
    approvedBy: p.approvedBy,
  }));
}

export function fxRateRows(ds: Pick<Dataset, "fxRates">): Omit<Prisma.FxRateCreateManyInput, "organizationId">[] {
  return ds.fxRates.map((f) => ({ date: dateOnly(f.date), usdToCad: money(f.usdToCad) }));
}

export function bankStatementRows(
  ds: Pick<Dataset, "bankStatement">,
): Omit<Prisma.BankStatementLineCreateManyInput, "organizationId">[] {
  return ds.bankStatement.map((b) => ({
    id: b.bankTxnId,
    postedDate: dateOnly(b.postedDate),
    description: b.description,
    debit: optMoney(b.debit),
    credit: optMoney(b.credit),
    source: "history",
  }));
}

export function cardTransactionRows(
  ds: Pick<Dataset, "cardTransactions">,
): Omit<Prisma.CardTransactionCreateManyInput, "organizationId">[] {
  return ds.cardTransactions.map((c) => ({
    id: c.txnId,
    cardId: c.cardId,
    cardholderUserId: c.cardholderUserId,
    postedDate: dateOnly(c.postedDate),
    merchantDescriptor: c.merchantDescriptor,
    mcc: c.mcc,
    amount: money(c.amount),
    currency: c.currency,
    amountCad: money(c.amountCad),
    source: c.source,
    receiptAttached: c.receiptAttached,
    memo: c.memo,
    origin: "history",
  }));
}

export function policyRuleRows(
  ds: Pick<Dataset, "approvalPolicies">,
): Omit<Prisma.PolicyRuleCreateManyInput, "organizationId">[] {
  return policyRulesFrom(ds.approvalPolicies).map((r) => ({
    id: r.id,
    type: r.type,
    active: r.active,
    locked: r.locked,
    when: r.when as unknown as Prisma.InputJsonValue,
    effect: r.effect as unknown as Prisma.InputJsonValue,
    sourceText: r.sourceText,
    note: r.note,
  }));
}

/** Loads every reference table. Returns the row count per table. */
export async function seedReference(tx: Tx, ds: Dataset, organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  counts.users = ds.users.length;
  counts.departments = (
    await tx.department.createMany({ data: departmentRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.glAccounts = (
    await tx.glAccount.createMany({ data: glAccountRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.taxCodes = (
    await tx.taxCode.createMany({ data: taxCodeRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.vendors = (
    await tx.vendor.createMany({ data: vendorRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.contracts = (
    await tx.contract.createMany({ data: contractRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.purchaseOrders = (
    await tx.purchaseOrder.createMany({ data: purchaseOrderRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.fxRates = (
    await tx.fxRate.createMany({ data: fxRateRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.bankStatement = (
    await tx.bankStatementLine.createMany({ data: bankStatementRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.cardTransactions = (
    await tx.cardTransaction.createMany({ data: cardTransactionRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  counts.policyRules = (
    await tx.policyRule.createMany({ data: policyRuleRows(ds).map((row) => ({ ...row, organizationId })) })
  ).count;
  return counts;
}
