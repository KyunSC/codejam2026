/**
 * Typed loaders for the Harborline dataset (brim_ap_dataset/).
 *
 * Shared by the seed (Loop A) and the rules engine and its tests (Loop B), so both read
 * the CSVs the same way. Server-only: it reads the filesystem.
 *
 * Conventions: money and rates are Decimal; dates stay `YYYY-MM-DD` strings; timestamps
 * stay ISO strings; "yes"/"no" become booleans; blank cells become null. Ids, bank numbers
 * and invoice numbers stay strings so leading zeros survive.
 *
 * Strict on purpose: an unknown enum value, an impossible date, a blank number or a
 * malformed email throws with the file and line, instead of flowing into the rules engine
 * typed as valid.
 *
 * Each loader reads its file once per process and returns the same frozen array after that,
 * so the rules engine can call loaders freely. Treat rows as read-only.
 *
 * This file only lists the dataset. It does not open anything in incoming_invoices/.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import Papa from "papaparse";
import { isRealIsoDate } from "./today";
import type { Currency, IsoDate, LineType, Province, Role, TaxCode } from "./types";

// ---------- Location ----------

/**
 * Dataset root. Override with DATASET_DIR; otherwise Brim/brim_ap_dataset, found whether
 * the process runs from Brim/ (npm scripts, Next, Vercel) or from the repo root.
 * Deployed functions get the files through `outputFileTracingIncludes` in next.config.ts.
 */
export function datasetDir(): string {
  if (process.env.DATASET_DIR) return process.env.DATASET_DIR;
  const candidates = [
    path.join(process.cwd(), "brim_ap_dataset"),
    path.join(process.cwd(), "Brim", "brim_ap_dataset"),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, "data")));
  if (!found) {
    throw new Error(
      `Dataset not found. Looked in: ${candidates.join(", ")}. Run from Brim/ or set DATASET_DIR.`,
    );
  }
  return found;
}

// ---------- Allowed values ----------

/**
 * Lists every member of the union T. Leaving one out, or adding a value outside T,
 * is a type error, so these lists cannot drift from types.ts.
 */
function allOf<T extends string>() {
  return <const A extends readonly T[]>(
    values: A & ([Exclude<T, A[number]>] extends [never] ? unknown : { missing: Exclude<T, A[number]> }),
  ): readonly T[] => values;
}

const ROLES = allOf<Role>()([
  "employee",
  "ap_clerk",
  "approver",
  "finance_manager",
  "controller_admin",
  "auditor",
]);
const PROVINCES = allOf<Province>()(["ON", "BC", "AB", "QC"]);
const CURRENCIES = allOf<Currency>()(["CAD", "USD"]);
const TAX_CODES = allOf<TaxCode>()(["HST13", "GST5", "PST7_BC", "QST9975", "EXEMPT", "FOREIGN"]);
const LINE_TYPES = allOf<LineType>()(["goods", "services"]);

const USER_STATUS = ["active", "on_leave", "terminated"] as const;
const VENDOR_STATUS = ["active", "pending_review", "on_hold"] as const;
const PAYMENT_METHOD = ["EFT", "CHEQUE", "CARD"] as const;
const RULE_TYPE = ["approval", "payment_release", "match"] as const;
const ACCOUNT_TYPE = ["asset", "expense", "liability"] as const;
const APPLIES_TO = ["all", "goods"] as const;
const RECOVERABLE = ["yes", "no", "n/a"] as const;
const COUNTRY = ["CA", "US"] as const;
const REQUEST_CHANNEL = ["email_request", "phone_callback_verified", "vendor_portal"] as const;
const BILLING_TYPE = ["fixed_monthly", "rate_card", "retainer", "blanket"] as const;
const CONTRACT_STATUS = ["active", "expired"] as const;
const PO_STATUS = ["open", "closed", "partially_invoiced"] as const;
const INVOICE_STATUS = ["pending_approval", "approved", "scheduled", "paid", "rejected"] as const;
const APPROVER_ROLE = ["dept_manager", "finance_manager"] as const;
const APPROVAL_ACTION = ["approved", "rejected"] as const;
const PAYMENT_STATUS = ["settled", "outstanding", "scheduled"] as const;
const CARD_SOURCE = ["employee_card", "ap_virtual_card"] as const;

// ---------- Cell parsers ----------

type Raw = Record<string, string>;

function str(r: Raw, k: string): string {
  const v = r[k];
  if (v === undefined) throw new Error(`Missing column "${k}"`);
  return v.trim();
}
function opt(r: Raw, k: string): string | null {
  const v = str(r, k);
  return v === "" ? null : v;
}
function oneOf<T extends string>(r: Raw, k: string, allowed: readonly T[]): T {
  const v = str(r, k);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(`Unexpected value in column "${k}": "${v}" (expected ${allowed.join(" | ")})`);
  }
  return v as T;
}
function optOneOf<T extends string>(r: Raw, k: string, allowed: readonly T[]): T | null {
  return opt(r, k) === null ? null : oneOf(r, k, allowed);
}
function date(r: Raw, k: string): IsoDate {
  const v = str(r, k);
  if (!isRealIsoDate(v)) throw new Error(`Not a YYYY-MM-DD date in column "${k}": "${v}"`);
  return v;
}
function optDate(r: Raw, k: string): IsoDate | null {
  return opt(r, k) === null ? null : date(r, k);
}
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
function isTimestamp(v: string): boolean {
  const m = TIMESTAMP.exec(v);
  return m !== null && isRealIsoDate(m[1]);
}
function timestamp(r: Raw, k: string): string {
  const v = str(r, k);
  if (!isTimestamp(v)) throw new Error(`Not an ISO timestamp in column "${k}": "${v}"`);
  return v;
}
function dec(r: Raw, k: string): Decimal {
  const v = str(r, k);
  if (v === "") throw new Error(`Blank number in column "${k}"`);
  return new Decimal(v);
}
function optDec(r: Raw, k: string): Decimal | null {
  const v = opt(r, k);
  return v === null ? null : new Decimal(v);
}
/**
 * Parses a whole-number cell. Strict on purpose: `Number("")` is 0, which would turn a
 * blank payment_terms_days into "due on receipt", and `Number("1e1")` is 10.
 */
export function parseIntCell(raw: string, column: string): number {
  const v = raw.trim();
  if (v === "") throw new Error(`Blank integer in column "${column}"`);
  if (!/^-?\d+$/.test(v)) throw new Error(`Not an integer in column "${column}": "${raw}"`);
  return Number.parseInt(v, 10);
}
function int(r: Raw, k: string): number {
  return parseIntCell(str(r, k), k);
}
function yes(r: Raw, k: string): boolean {
  const v = str(r, k).toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  throw new Error(`Expected yes/no in column "${k}", got "${r[k]}"`);
}

// ---------- Reading and caching ----------

const cache = new Map<string, ReadonlyArray<unknown>>();

/** Loads once per dataset directory, then returns the same frozen rows. */
function cached<T>(name: string, load: () => T[]): ReadonlyArray<Readonly<T>> {
  const key = `${datasetDir()}\u0000${name}`;
  let rows = cache.get(key) as ReadonlyArray<Readonly<T>> | undefined;
  if (!rows) {
    rows = Object.freeze(load().map((row) => Object.freeze(row)));
    cache.set(key, rows);
  }
  return rows;
}

/** Drops cached rows, e.g. in a test that points DATASET_DIR at fixtures and edits them. */
export function clearDatasetCache(): void {
  cache.clear();
}

/** Reads a CSV and maps each row, naming the file and line on any error. */
function readCsv<T>(file: string, map: (r: Raw) => T): T[] {
  const text = readFileSync(path.join(datasetDir(), "data", file), "utf8");
  const parsed = Papa.parse<Raw>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    const e = parsed.errors[0];
    // Papa counts data rows from 0; the file line is 2 more (1-based, after the header).
    const where = e.row === undefined ? "" : ` line ${e.row + 2}`;
    throw new Error(`${file}${where}: ${e.message} (${parsed.errors.length} error(s) in total)`);
  }
  return parsed.data.map((r, i) => {
    try {
      return map(r);
    } catch (err) {
      throw new Error(`${file} line ${i + 2}: ${(err as Error).message}`);
    }
  });
}

// ---------- Row types ----------

export type UserStatus = (typeof USER_STATUS)[number];
export type VendorStatus = (typeof VENDOR_STATUS)[number];
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export interface UserRow {
  userId: string;
  fullName: string;
  email: string;
  title: string;
  departmentId: string;
  managerId: string | null;
  role: Role;
  approvalLimitCad: Decimal;
  workProvince: Province;
  status: UserStatus;
  statusSince: IsoDate | null;
  delegateUserId: string | null;
  hireDate: IsoDate;
}

export interface DepartmentRow {
  departmentId: string;
  name: string;
  costCentre: string;
  annualBudgetCad: Decimal;
  managerUserId: string;
}

export interface ApprovalPolicyRow {
  ruleId: string;
  ruleType: (typeof RULE_TYPE)[number];
  /** Free text in the CSV; the seed maps each rule to a structured row by hand. */
  condition: string;
  required: string;
  notes: string | null;
}

export interface GlAccountRow {
  accountNumber: string;
  name: string;
  accountType: (typeof ACCOUNT_TYPE)[number];
  notes: string | null;
}

export interface TaxCodeRow {
  code: TaxCode;
  description: string;
  rate: Decimal;
  appliesTo: (typeof APPLIES_TO)[number];
  recoverable: (typeof RECOVERABLE)[number];
  glAccount: string | null;
}

export interface VendorRow {
  vendorId: string;
  legalName: string;
  category: string;
  defaultGlAccount: string;
  address: string;
  provinceOrState: string;
  country: (typeof COUNTRY)[number];
  gstHstNumber: string | null;
  qstNumber: string | null;
  paymentTermsDays: number;
  /** e.g. "2/10 net 30". */
  earlyPayDiscount: string | null;
  preferredPaymentMethod: PaymentMethod;
  acceptsCardPayment: boolean;
  bankInstitution: string | null;
  bankTransit: string | null;
  bankAccount: string | null;
  bankDetailsUpdatedAt: IsoDate | null;
  apContactEmail: string;
  requiresPo: boolean;
  status: VendorStatus;
  onboardedAt: IsoDate;
}

export interface BankChangeRow {
  changeId: string;
  vendorId: string;
  changedAt: IsoDate;
  changedByUserId: string;
  requestChannel: (typeof REQUEST_CHANNEL)[number];
  verifiedByCallback: boolean;
  oldAccountLast4: string;
  newAccountLast4: string;
}

export interface ContractRow {
  contractId: string;
  vendorId: string;
  description: string;
  billingType: (typeof BILLING_TYPE)[number];
  monthlyFee: Decimal | null;
  currency: Currency;
  hourlyRateCap: Decimal | null;
  /** As written in the CSV, e.g. 12 means 12%. */
  fuelSurchargeCapPct: Decimal | null;
  notToExceedMonthly: Decimal | null;
  startDate: IsoDate;
  endDate: IsoDate;
  autoRenew: boolean;
  status: (typeof CONTRACT_STATUS)[number];
}

export interface PurchaseOrderRow {
  poId: string;
  vendorId: string;
  departmentId: string;
  requesterUserId: string;
  issueDate: IsoDate;
  description: string;
  /** Pre-tax (BUILD_PLAN PO_OVER_BALANCE). */
  totalAmount: Decimal;
  currency: Currency;
  status: (typeof PO_STATUS)[number];
  approvedBy: string;
}

export interface InvoiceRow {
  invoiceId: string;
  vendorId: string;
  vendorInvoiceNumber: string;
  invoiceDate: IsoDate;
  receivedDate: IsoDate;
  dueDate: IsoDate;
  currency: Currency;
  subtotal: Decimal;
  gstHstAmount: Decimal;
  pstQstAmount: Decimal;
  total: Decimal;
  fxRateToCad: Decimal;
  totalCad: Decimal;
  departmentId: string;
  requesterUserId: string;
  poId: string | null;
  contractId: string | null;
  shipToProvince: Province;
  status: (typeof INVOICE_STATUS)[number];
}

export interface InvoiceLineRow {
  invoiceId: string;
  lineNo: number;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  amount: Decimal;
  glAccount: string;
  departmentId: string;
  gstHstCode: TaxCode | null;
  pstQstCode: TaxCode | null;
  lineType: LineType;
}

export interface ApprovalRow {
  approvalId: string;
  invoiceId: string;
  stepNo: number;
  approverUserId: string;
  approverRole: (typeof APPROVER_ROLE)[number];
  action: (typeof APPROVAL_ACTION)[number];
  /** ISO timestamp without zone, e.g. 2026-01-03T15:59:00. */
  actedAt: string;
  comment: string | null;
}

export interface PaymentRow {
  paymentId: string;
  invoiceId: string;
  vendorId: string;
  method: PaymentMethod;
  scheduledDate: IsoDate;
  paidDate: IsoDate | null;
  currency: Currency;
  amount: Decimal;
  fxRateToCad: Decimal;
  amountCad: Decimal;
  discountTaken: Decimal;
  reference: string;
  status: (typeof PAYMENT_STATUS)[number];
  preparedBy: string;
  releasedBy: string | null;
}

/** Exactly one of debit and credit is set on every row. */
export interface BankStatementRow {
  bankTxnId: string;
  postedDate: IsoDate;
  description: string;
  debit: Decimal | null;
  credit: Decimal | null;
}

export interface CardTransactionRow {
  txnId: string;
  cardId: string;
  cardholderUserId: string;
  postedDate: IsoDate;
  merchantDescriptor: string;
  mcc: string;
  amount: Decimal;
  currency: Currency;
  amountCad: Decimal;
  source: (typeof CARD_SOURCE)[number];
  receiptAttached: boolean;
  memo: string | null;
}

export interface FxRateRow {
  date: IsoDate;
  usdToCad: Decimal;
}

export interface EmailRow {
  emailId: string;
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  /** ISO timestamp. */
  receivedAt: string;
  body: string;
  /** File names in incoming_invoices/. */
  attachments: string[];
}

// ---------- Loaders ----------

export function loadUsers() {
  return cached("users", () =>
    readCsv("users.csv", (r): UserRow => ({
      userId: str(r, "user_id"),
      fullName: str(r, "full_name"),
      email: str(r, "email"),
      title: str(r, "title"),
      departmentId: str(r, "department_id"),
      managerId: opt(r, "manager_id"),
      role: oneOf(r, "role", ROLES),
      approvalLimitCad: dec(r, "approval_limit_cad"),
      workProvince: oneOf(r, "work_province", PROVINCES),
      status: oneOf(r, "status", USER_STATUS),
      statusSince: optDate(r, "status_since"),
      delegateUserId: opt(r, "delegate_user_id"),
      hireDate: date(r, "hire_date"),
    })),
  );
}

export function loadDepartments() {
  return cached("departments", () =>
    readCsv("departments.csv", (r): DepartmentRow => ({
      departmentId: str(r, "department_id"),
      name: str(r, "name"),
      costCentre: str(r, "cost_centre"),
      annualBudgetCad: dec(r, "annual_budget_cad"),
      managerUserId: str(r, "manager_user_id"),
    })),
  );
}

export function loadApprovalPolicies() {
  return cached("approval_policies", () =>
    readCsv("approval_policies.csv", (r): ApprovalPolicyRow => ({
      ruleId: str(r, "rule_id"),
      ruleType: oneOf(r, "rule_type", RULE_TYPE),
      condition: str(r, "condition"),
      required: str(r, "required"),
      notes: opt(r, "notes"),
    })),
  );
}

export function loadGlAccounts() {
  return cached("gl_accounts", () =>
    readCsv("gl_accounts.csv", (r): GlAccountRow => ({
      accountNumber: str(r, "account_number"),
      name: str(r, "name"),
      accountType: oneOf(r, "account_type", ACCOUNT_TYPE),
      notes: opt(r, "notes"),
    })),
  );
}

export function loadTaxCodes() {
  return cached("tax_codes", () =>
    readCsv("tax_codes.csv", (r): TaxCodeRow => ({
      code: oneOf(r, "code", TAX_CODES),
      description: str(r, "description"),
      rate: dec(r, "rate"),
      appliesTo: oneOf(r, "applies_to", APPLIES_TO),
      recoverable: oneOf(r, "recoverable", RECOVERABLE),
      glAccount: opt(r, "gl_account"),
    })),
  );
}

export function loadVendors() {
  return cached("vendors", () =>
    readCsv("vendors.csv", (r): VendorRow => ({
      vendorId: str(r, "vendor_id"),
      legalName: str(r, "legal_name"),
      category: str(r, "category"),
      defaultGlAccount: str(r, "default_gl_account"),
      address: str(r, "address"),
      provinceOrState: str(r, "province_or_state"),
      country: oneOf(r, "country", COUNTRY),
      gstHstNumber: opt(r, "gst_hst_number"),
      qstNumber: opt(r, "qst_number"),
      paymentTermsDays: int(r, "payment_terms_days"),
      earlyPayDiscount: opt(r, "early_pay_discount"),
      preferredPaymentMethod: oneOf(r, "preferred_payment_method", PAYMENT_METHOD),
      acceptsCardPayment: yes(r, "accepts_card_payment"),
      bankInstitution: opt(r, "bank_institution"),
      bankTransit: opt(r, "bank_transit"),
      bankAccount: opt(r, "bank_account"),
      bankDetailsUpdatedAt: optDate(r, "bank_details_updated_at"),
      apContactEmail: str(r, "ap_contact_email"),
      requiresPo: yes(r, "requires_po"),
      status: oneOf(r, "status", VENDOR_STATUS),
      onboardedAt: date(r, "onboarded_at"),
    })),
  );
}

export function loadBankChanges() {
  return cached("bank_change_history", () =>
    readCsv("bank_change_history.csv", (r): BankChangeRow => ({
      changeId: str(r, "change_id"),
      vendorId: str(r, "vendor_id"),
      changedAt: date(r, "changed_at"),
      changedByUserId: str(r, "changed_by_user_id"),
      requestChannel: oneOf(r, "request_channel", REQUEST_CHANNEL),
      verifiedByCallback: yes(r, "verified_by_callback"),
      oldAccountLast4: str(r, "old_account_last4"),
      newAccountLast4: str(r, "new_account_last4"),
    })),
  );
}

export function loadContracts() {
  return cached("contracts", () =>
    readCsv("contracts.csv", (r): ContractRow => ({
      contractId: str(r, "contract_id"),
      vendorId: str(r, "vendor_id"),
      description: str(r, "description"),
      billingType: oneOf(r, "billing_type", BILLING_TYPE),
      monthlyFee: optDec(r, "monthly_fee"),
      currency: oneOf(r, "currency", CURRENCIES),
      hourlyRateCap: optDec(r, "hourly_rate_cap"),
      fuelSurchargeCapPct: optDec(r, "fuel_surcharge_cap_pct"),
      notToExceedMonthly: optDec(r, "not_to_exceed_monthly"),
      startDate: date(r, "start_date"),
      endDate: date(r, "end_date"),
      autoRenew: yes(r, "auto_renew"),
      status: oneOf(r, "status", CONTRACT_STATUS),
    })),
  );
}

export function loadPurchaseOrders() {
  return cached("purchase_orders", () =>
    readCsv("purchase_orders.csv", (r): PurchaseOrderRow => ({
      poId: str(r, "po_id"),
      vendorId: str(r, "vendor_id"),
      departmentId: str(r, "department_id"),
      requesterUserId: str(r, "requester_user_id"),
      issueDate: date(r, "issue_date"),
      description: str(r, "description"),
      totalAmount: dec(r, "total_amount"),
      currency: oneOf(r, "currency", CURRENCIES),
      status: oneOf(r, "status", PO_STATUS),
      approvedBy: str(r, "approved_by"),
    })),
  );
}

export function loadInvoices() {
  return cached("invoices", () =>
    readCsv("invoices.csv", (r): InvoiceRow => ({
      invoiceId: str(r, "invoice_id"),
      vendorId: str(r, "vendor_id"),
      vendorInvoiceNumber: str(r, "vendor_invoice_number"),
      invoiceDate: date(r, "invoice_date"),
      receivedDate: date(r, "received_date"),
      dueDate: date(r, "due_date"),
      currency: oneOf(r, "currency", CURRENCIES),
      subtotal: dec(r, "subtotal"),
      gstHstAmount: dec(r, "gst_hst_amount"),
      pstQstAmount: dec(r, "pst_qst_amount"),
      total: dec(r, "total"),
      fxRateToCad: dec(r, "fx_rate_to_cad"),
      totalCad: dec(r, "total_cad"),
      departmentId: str(r, "department_id"),
      requesterUserId: str(r, "requester_user_id"),
      poId: opt(r, "po_id"),
      contractId: opt(r, "contract_id"),
      shipToProvince: oneOf(r, "ship_to_province", PROVINCES),
      status: oneOf(r, "status", INVOICE_STATUS),
    })),
  );
}

export function loadInvoiceLines() {
  return cached("invoice_lines", () =>
    readCsv("invoice_lines.csv", (r): InvoiceLineRow => ({
      invoiceId: str(r, "invoice_id"),
      lineNo: int(r, "line_no"),
      description: str(r, "description"),
      quantity: dec(r, "quantity"),
      unitPrice: dec(r, "unit_price"),
      amount: dec(r, "amount"),
      glAccount: str(r, "gl_account"),
      departmentId: str(r, "department_id"),
      gstHstCode: optOneOf(r, "gst_hst_code", TAX_CODES),
      pstQstCode: optOneOf(r, "pst_qst_code", TAX_CODES),
      lineType: oneOf(r, "line_type", LINE_TYPES),
    })),
  );
}

export function loadApprovals() {
  return cached("approvals", () =>
    readCsv("approvals.csv", (r): ApprovalRow => ({
      approvalId: str(r, "approval_id"),
      invoiceId: str(r, "invoice_id"),
      stepNo: int(r, "step_no"),
      approverUserId: str(r, "approver_user_id"),
      approverRole: oneOf(r, "approver_role", APPROVER_ROLE),
      action: oneOf(r, "action", APPROVAL_ACTION),
      actedAt: timestamp(r, "acted_at"),
      comment: opt(r, "comment"),
    })),
  );
}

export function loadPayments() {
  return cached("payments", () =>
    readCsv("payments.csv", (r): PaymentRow => ({
      paymentId: str(r, "payment_id"),
      invoiceId: str(r, "invoice_id"),
      vendorId: str(r, "vendor_id"),
      method: oneOf(r, "method", PAYMENT_METHOD),
      scheduledDate: date(r, "scheduled_date"),
      paidDate: optDate(r, "paid_date"),
      currency: oneOf(r, "currency", CURRENCIES),
      amount: dec(r, "amount"),
      fxRateToCad: dec(r, "fx_rate_to_cad"),
      amountCad: dec(r, "amount_cad"),
      discountTaken: dec(r, "discount_taken"),
      reference: str(r, "reference"),
      status: oneOf(r, "status", PAYMENT_STATUS),
      preparedBy: str(r, "prepared_by"),
      releasedBy: opt(r, "released_by"),
    })),
  );
}

export function loadBankStatement() {
  return cached("bank_statement", () =>
    readCsv("bank_statement.csv", (r): BankStatementRow => {
      const debit = optDec(r, "debit");
      const credit = optDec(r, "credit");
      // A refund or reversal arrives as a credit with no debit; both or neither is a bad row.
      if ((debit === null) === (credit === null)) {
        throw new Error("Expected exactly one of debit and credit");
      }
      return {
        bankTxnId: str(r, "bank_txn_id"),
        postedDate: date(r, "posted_date"),
        description: str(r, "description"),
        debit,
        credit,
      };
    }),
  );
}

export function loadCardTransactions() {
  return cached("card_transactions", () =>
    readCsv("card_transactions.csv", (r): CardTransactionRow => ({
      txnId: str(r, "txn_id"),
      cardId: str(r, "card_id"),
      cardholderUserId: str(r, "cardholder_user_id"),
      postedDate: date(r, "posted_date"),
      merchantDescriptor: str(r, "merchant_descriptor"),
      mcc: str(r, "mcc"),
      amount: dec(r, "amount"),
      currency: oneOf(r, "currency", CURRENCIES),
      amountCad: dec(r, "amount_cad"),
      source: oneOf(r, "source", CARD_SOURCE),
      receiptAttached: yes(r, "receipt_attached"),
      memo: opt(r, "memo"),
    })),
  );
}

export function loadFxRates() {
  return cached("fx_rates", () =>
    readCsv("fx_rates.csv", (r): FxRateRow => ({
      date: date(r, "date"),
      usdToCad: dec(r, "usd_to_cad"),
    })),
  );
}

/** Parses emails.json. Throws on a missing or non-string field instead of storing "undefined". */
export function parseEmails(json: string): EmailRow[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("emails.json: expected an array");
  return raw.map((e: Record<string, unknown>, i) => {
    const where = `emails.json[${i}]${typeof e?.email_id === "string" ? ` (${e.email_id})` : ""}`;
    const text = (k: string): string => {
      const v = e?.[k];
      if (typeof v !== "string") throw new Error(`${where}: "${k}" must be a string, got ${JSON.stringify(v)}`);
      return v;
    };
    const receivedAt = text("received_at").trim();
    if (!isTimestamp(receivedAt)) throw new Error(`${where}: "received_at" is not an ISO timestamp: "${receivedAt}"`);
    const attachments = e.attachments;
    if (!Array.isArray(attachments) || !attachments.every((a) => typeof a === "string")) {
      throw new Error(`${where}: "attachments" must be an array of file names`);
    }
    return {
      emailId: text("email_id").trim(),
      fromName: text("from_name").trim(),
      fromAddress: text("from_address").trim(),
      toAddress: text("to_address").trim(),
      subject: text("subject"),
      receivedAt,
      body: text("body"),
      attachments: attachments.map((a: string) => a.trim()),
    };
  });
}

export function loadEmails() {
  return cached("emails", () =>
    parseEmails(readFileSync(path.join(datasetDir(), "inbox", "emails.json"), "utf8")),
  );
}

/** Everything at once, for the seed and the history replay. */
export function loadDataset() {
  return {
    users: loadUsers(),
    departments: loadDepartments(),
    approvalPolicies: loadApprovalPolicies(),
    glAccounts: loadGlAccounts(),
    taxCodes: loadTaxCodes(),
    vendors: loadVendors(),
    bankChanges: loadBankChanges(),
    contracts: loadContracts(),
    purchaseOrders: loadPurchaseOrders(),
    invoices: loadInvoices(),
    invoiceLines: loadInvoiceLines(),
    approvals: loadApprovals(),
    payments: loadPayments(),
    bankStatement: loadBankStatement(),
    cardTransactions: loadCardTransactions(),
    fxRates: loadFxRates(),
    emails: loadEmails(),
  };
}

export type Dataset = ReturnType<typeof loadDataset>;
