/**
 * Reference data the rules read, indexed once (BUILD_PLAN Resolution, Checks, Duplicate detection).
 *
 * `Refs` is everything a check may look at besides the invoice itself. Two parts:
 * - static reference tables (vendors, users, contracts, POs, FX, card charges, …)
 * - `invoices`: the invoices already known when this one is checked. For a new invoice that is
 *   all of history plus the earlier part of the batch; for the history replay it is the invoices
 *   that came before it (see `refsAsOf`). Checks never look at invoices outside this list, so a
 *   duplicate pair flags once, on the second arrival.
 *
 * `self` identifies the invoice being checked when it already exists (history replay), so checks
 * that need its own approvals or payments can read them. `ResolvedInvoice` has no id field.
 */
import type Decimal from "decimal.js";
import type {
  ApprovalRow,
  BankChangeRow,
  CardTransactionRow,
  ContractRow,
  Dataset,
  DepartmentRow,
  FxRateRow,
  GlAccountRow,
  PaymentRow,
  PurchaseOrderRow,
  TaxCodeRow,
  UserRow,
  VendorRow,
} from "../dataset";
import type { Currency, InvoiceKind, IsoDate, LineType, Province, TaxCode } from "../types";

/** An invoice already in the system, as the checks need to see it. */
export interface KnownInvoice {
  invoiceId: string;
  kind: InvoiceKind;
  vendorId: string | null;
  invoiceNumber: string | null;
  numberKey: string | null;
  digitsKey: string | null;
  invoiceDate: IsoDate | null;
  receivedDate: IsoDate;
  dueDate: IsoDate | null;
  currency: Currency | null;
  subtotal: Decimal | null;
  total: Decimal | null;
  totalCad: Decimal | null;
  /** Invoice status in history, or the app state for new ones. */
  status: string;
  poId: string | null;
  contractId: string | null;
  departmentId: string | null;
  requesterId: string | null;
  shipToProvince: Province | null;
  lines: Array<{
    description: string;
    amount: Decimal | null;
    glAccount: string | null;
    departmentId: string | null;
    lineType: LineType | null;
    taxCodes: TaxCode[];
  }>;
}

export interface Refs {
  today: IsoDate;
  vendors: ReadonlyMap<string, VendorRow>;
  vendorList: readonly VendorRow[];
  users: ReadonlyMap<string, UserRow>;
  userList: readonly UserRow[];
  departments: ReadonlyMap<string, DepartmentRow>;
  glAccounts: ReadonlyMap<string, GlAccountRow>;
  taxCodes: ReadonlyMap<TaxCode, TaxCodeRow>;
  contracts: ReadonlyMap<string, ContractRow>;
  /** Each vendor has at most one contract (verified by scripts/verify-counts.ts). */
  contractByVendor: ReadonlyMap<string, ContractRow>;
  purchaseOrders: ReadonlyMap<string, PurchaseOrderRow>;
  posByVendor: ReadonlyMap<string, readonly PurchaseOrderRow[]>;
  /** Oldest first. */
  bankChangesByVendor: ReadonlyMap<string, readonly BankChangeRow[]>;
  /** Sorted by date. */
  fxRates: readonly FxRateRow[];
  cardTransactions: readonly CardTransactionRow[];
  approvalsByInvoice: ReadonlyMap<string, readonly ApprovalRow[]>;
  paymentsByInvoice: ReadonlyMap<string, readonly PaymentRow[]>;
  /** Invoices known before this one; see the file comment. */
  invoices: readonly KnownInvoice[];
  invoicesByVendor: ReadonlyMap<string, readonly KnownInvoice[]>;
  /** The invoice being checked, when it already has an id. */
  self: { invoiceId: string } | null;
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Builds the static part of Refs from the dataset, with the given known invoices. */
export function buildRefs(ds: Dataset, invoices: readonly KnownInvoice[], today: IsoDate): Refs {
  const bankChangesByVendor = groupBy(ds.bankChanges, (b) => b.vendorId);
  for (const list of bankChangesByVendor.values()) {
    list.sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.changeId.localeCompare(b.changeId));
  }
  return {
    today,
    vendors: new Map(ds.vendors.map((v) => [v.vendorId, v])),
    vendorList: ds.vendors,
    users: new Map(ds.users.map((u) => [u.userId, u])),
    userList: ds.users,
    departments: new Map(ds.departments.map((d) => [d.departmentId, d])),
    glAccounts: new Map(ds.glAccounts.map((g) => [g.accountNumber, g])),
    taxCodes: new Map(ds.taxCodes.map((t) => [t.code, t])),
    contracts: new Map(ds.contracts.map((c) => [c.contractId, c])),
    contractByVendor: new Map(ds.contracts.map((c) => [c.vendorId, c])),
    purchaseOrders: new Map(ds.purchaseOrders.map((p) => [p.poId, p])),
    posByVendor: groupBy(ds.purchaseOrders, (p) => p.vendorId),
    bankChangesByVendor,
    fxRates: [...ds.fxRates].sort((a, b) => a.date.localeCompare(b.date)),
    cardTransactions: ds.cardTransactions,
    approvalsByInvoice: groupBy(ds.approvals, (a) => a.invoiceId),
    paymentsByInvoice: groupBy(ds.payments, (p) => p.invoiceId),
    invoices,
    invoicesByVendor: groupBy(invoices, (i) => i.vendorId),
    self: null,
  };
}

/** A view of `refs` whose known invoices are replaced, e.g. only those before the one being checked. */
export function withInvoices(refs: Refs, invoices: readonly KnownInvoice[], self: Refs["self"] = null): Refs {
  return { ...refs, invoices, invoicesByVendor: groupBy(invoices, (i) => i.vendorId), self };
}

/**
 * History replay order: received date, then invoice id (ids follow entry order).
 * Returns, for each invoice, refs holding only the invoices entered before it.
 */
export function* refsAsOf(refs: Refs, all: readonly KnownInvoice[]): Generator<[KnownInvoice, Refs]> {
  const ordered = [...all].sort(
    (a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.invoiceId.localeCompare(b.invoiceId),
  );
  for (let i = 0; i < ordered.length; i++) {
    yield [ordered[i], withInvoices(refs, ordered.slice(0, i), { invoiceId: ordered[i].invoiceId })];
  }
}
