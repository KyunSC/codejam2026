/**
 * Refs for the app: the rules engine's reference data (src/lib/rules/refs.ts) as the database holds
 * it now, not as the CSVs shipped it.
 *
 * Static tables that the app never edits (departments, GL accounts, tax codes, contracts, POs, FX,
 * card charges, history approvals and payments) come from the dataset, parsed once per process.
 * Everything the app can change comes from the database: vendors (status, live bank account, vendors
 * onboarded in the app), bank change requests, users (status, delegate, manager), the policy rules,
 * and the invoices already known (history with its current status, plus app invoices received
 * before this one).
 *
 * Ids follow the dataset: users by `externalId` (U001 …), falling back to the row id for people
 * added in the app, so the rules and the workflow tables (ApprovalStep, Flag) use one id space.
 */
import Decimal from "decimal.js";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { type BankChangeRow, type Dataset, loadDataset, type UserRow, type VendorRow } from "@/lib/dataset";
import { loadHistory } from "@/lib/rules/history";
import { buildRefs, type KnownInvoice, type Refs } from "@/lib/rules/refs";
import type { PolicyRule } from "@/lib/rules/routing/policy";
import { today } from "@/lib/today";
import type { Currency, InvoiceKind, IsoDate, LineType, Province, TaxCode } from "@/lib/types";

type Db = Prisma.TransactionClient | PrismaClient;

let staticCache: { ds: Dataset; history: KnownInvoice[] } | null = null;
function staticData() {
  if (!staticCache) {
    const ds = loadDataset();
    staticCache = { ds, history: loadHistory(ds).known };
  }
  return staticCache;
}

export const iso = (d: Date | null | undefined): IsoDate | null => (d ? d.toISOString().slice(0, 10) : null);
const dec = (v: Prisma.Decimal | null | undefined): Decimal | null => (v === null || v === undefined ? null : new Decimal(v.toString()));

/**
 * Two id spaces for people. The database (requesterId, ApprovalStep, Payment, BankChangeRequest …)
 * stores the User row id. The rules engine reads the dataset's ids (U001 …), which its messages
 * print. `personId` is the rules id: externalId, or the row id for people added in the app.
 */
export const personId = (u: { id: string; externalId: string | null }) => u.externalId ?? u.id;

/** Translates between the database's row ids and the rules' person ids. */
export interface People {
  toPerson(rowId: string | null | undefined): string | null;
  toRow(pid: string | null | undefined): string | null;
}

export function peopleFrom(users: ReadonlyArray<{ id: string; externalId: string | null }>): People {
  const byRow = new Map(users.map((u) => [u.id, personId(u)]));
  const byPid = new Map(users.map((u) => [personId(u), u.id]));
  return {
    toPerson: (rowId) => (rowId ? (byRow.get(rowId) ?? rowId) : null),
    toRow: (pid) => (pid ? (byPid.get(pid) ?? (byRow.has(pid) ? pid : null)) : null),
  };
}

export async function loadPeople(db: Db, organizationId: string): Promise<People> {
  return peopleFrom(await db.user.findMany({ where: { organizationId }, select: { id: true, externalId: true } }));
}

export type LiveRefs = Refs & { people: People };

export interface LiveRefsOptions {
  /** The invoice being checked: only app invoices received before it are "known". */
  self?: { invoiceId: string; receivedDate: Date; status?: string } | null;
}

/** Loads Refs from the database for one organization. */
export async function loadLiveRefs(db: Db, organizationId: string, opts: LiveRefsOptions = {}): Promise<LiveRefs> {
  const { ds, history } = staticData();

  const [vendors, accounts, changes, users, rules, historyStatus, appInvoices] = await Promise.all([
    db.vendor.findMany({ where: { organizationId } }),
    db.vendorBankAccount.findMany({ where: { organizationId, validTo: null }, orderBy: { validFrom: "asc" } }),
    db.bankChangeRequest.findMany({ where: { organizationId, status: { not: "rejected" } } }),
    db.user.findMany({ where: { organizationId } }),
    db.policyRule.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    db.invoice.findMany({ where: { organizationId, source: "history" }, select: { id: true, status: true } }),
    db.invoice.findMany({
      where: {
        organizationId,
        source: { not: "history" },
        ...(opts.self ? { id: { not: opts.self.invoiceId } } : {}),
      },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    }),
  ]);

  const liveAccount = new Map(accounts.map((a) => [a.vendorId, a]));
  const vendorRows: VendorRow[] = vendors.map((v) => {
    const acct = liveAccount.get(v.id);
    return {
      vendorId: v.id,
      legalName: v.legalName,
      category: v.category,
      defaultGlAccount: v.defaultGlAccount,
      address: v.address,
      provinceOrState: v.provinceOrState,
      country: v.country as VendorRow["country"],
      gstHstNumber: v.gstHstNumber,
      qstNumber: v.qstNumber,
      paymentTermsDays: v.paymentTermsDays,
      earlyPayDiscount: v.earlyPayDiscount,
      preferredPaymentMethod: v.preferredPaymentMethod as VendorRow["preferredPaymentMethod"],
      acceptsCardPayment: v.acceptsCardPayment,
      bankInstitution: acct?.institution ?? null,
      bankTransit: acct?.transit ?? null,
      bankAccount: acct?.account ?? null,
      bankDetailsUpdatedAt: iso(acct?.validFrom),
      apContactEmail: v.apContactEmail,
      requiresPo: v.requiresPo,
      status: v.status as VendorRow["status"],
      onboardedAt: iso(v.onboardedAt)!,
    };
  });

  const people = peopleFrom(users);
  const byRowId = new Map(users.map((u) => [u.id, u]));
  const pid = (rowId: string | null) => {
    const u = rowId ? byRowId.get(rowId) : undefined;
    return u ? personId(u) : null;
  };
  const userRows: UserRow[] = users.map((u) => ({
    userId: personId(u),
    fullName: u.fullName,
    email: u.email,
    title: u.title ?? "",
    departmentId: u.departmentId ?? "",
    managerId: pid(u.managerId),
    role: u.role,
    approvalLimitCad: dec(u.approvalLimitCad) ?? new Decimal(0),
    workProvince: (u.workProvince ?? "ON") as Province,
    status: u.status,
    statusSince: iso(u.statusSince),
    delegateUserId: pid(u.delegateId),
    hireDate: iso(u.hireDate) ?? "2026-01-01",
  }));

  const changeRows: BankChangeRow[] = changes.map((c) => ({
    changeId: c.id,
    vendorId: c.vendorId,
    changedAt: iso(c.requestedAt)!,
    changedByUserId: people.toPerson(c.requestedById) ?? c.requestedById,
    requestChannel: c.channel as BankChangeRow["requestChannel"],
    verifiedByCallback: c.status === "verified" && c.verifiedByCallback,
    oldAccountLast4: c.oldLast4,
    newAccountLast4: c.newLast4,
  }));

  const statusNow = new Map(historyStatus.map((h) => [h.id, h.status]));
  const known: KnownInvoice[] = history.map((h) => ({ ...h, status: statusNow.get(h.invoiceId) ?? h.status }));
  const selfKey = opts.self ? `${iso(opts.self.receivedDate)}|${opts.self.invoiceId}` : null;
  for (const inv of appInvoices) {
    if (inv.normalized === null) continue;
    if (selfKey && `${iso(inv.receivedDate)}|${inv.id}` >= selfKey) continue;
    known.push(knownFromRow(inv, people));
  }

  const policyRules: PolicyRule[] = rules.map((r) => ({
    id: r.id,
    type: r.type as PolicyRule["type"],
    active: r.active,
    locked: r.locked,
    when: r.when as unknown as PolicyRule["when"],
    effect: r.effect as unknown as PolicyRule["effect"],
    sourceText: r.sourceText,
    note: r.note,
  }));

  const live: Dataset = { ...ds, vendors: vendorRows, users: userRows, bankChanges: changeRows };
  const refs = buildRefs(live, known, today(), policyRules.length ? policyRules : undefined);
  return { ...refs, people, ...(opts.self ? { self: { invoiceId: opts.self.invoiceId, status: opts.self.status } } : {}) };
}

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

/** An app invoice as later invoices are compared against it. */
export function knownFromRow(inv: InvoiceWithLines, people?: People): KnownInvoice {
  return {
    invoiceId: inv.id,
    kind: inv.kind as InvoiceKind,
    vendorId: inv.vendorId,
    invoiceNumber: inv.invoiceNumber,
    numberKey: inv.numberKey,
    digitsKey: inv.digitsKey,
    invoiceDate: iso(inv.invoiceDate),
    receivedDate: iso(inv.receivedDate)!,
    dueDate: iso(inv.dueDate),
    currency: inv.currency as Currency | null,
    subtotal: dec(inv.subtotal),
    total: dec(inv.total),
    totalCad: dec(inv.totalCad),
    status: inv.status,
    poId: inv.poId,
    contractId: inv.contractId,
    departmentId: inv.departmentId,
    requesterId: people ? people.toPerson(inv.requesterId) : inv.requesterId,
    shipToProvince: inv.shipToProvince as Province | null,
    lines: inv.lines.map((l) => ({
      description: l.description,
      amount: dec(l.amount),
      glAccount: l.glFinal ?? l.glSuggested,
      departmentId: l.departmentFinal ?? l.departmentSuggested,
      lineType: l.lineType as LineType | null,
      taxCodes: [l.gstHstCode, l.pstQstCode].filter((c): c is TaxCode => !!c),
    })),
  };
}
