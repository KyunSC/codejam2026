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
 * This file only lists the dataset. It does not open anything in incoming_invoices/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import Papa from "papaparse";
import type { Currency, IsoDate, LineType, Province, Role, TaxCode } from "./types";

// ---------- Location ----------

/** Dataset root. Override with DATASET_DIR; defaults to Brim/brim_ap_dataset. */
export function datasetDir(): string {
  return process.env.DATASET_DIR ?? path.join(process.cwd(), "brim_ap_dataset");
}

// ---------- Cell parsers ----------

type Raw = Record<string, string>;

function str(r: Raw, k: string): string {
  const v = r[k];
  if (v === undefined) throw new Error(`Missing column "${k}"`);
  return v;
}
function opt(r: Raw, k: string): string | null {
  const v = str(r, k).trim();
  return v === "" ? null : v;
}
function dec(r: Raw, k: string): Decimal {
  const v = str(r, k).trim();
  if (v === "") throw new Error(`Blank number in column "${k}"`);
  return new Decimal(v);
}
function optDec(r: Raw, k: string): Decimal | null {
  const v = opt(r, k);
  return v === null ? null : new Decimal(v);
}
function int(r: Raw, k: string): number {
  const n = Number(str(r, k));
  if (!Number.isInteger(n)) throw new Error(`Not an integer in column "${k}": ${r[k]}`);
  return n;
}
function yes(r: Raw, k: string): boolean {
  const v = str(r, k).trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  throw new Error(`Expected yes/no in column "${k}", got "${r[k]}"`);
}

function readCsv(file: string): Raw[] {
  const text = readFileSync(path.join(datasetDir(), "data", file), "utf8");
  const parsed = Papa.parse<Raw>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    const e = parsed.errors[0];
    throw new Error(`${file} row ${e.row}: ${e.message}`);
  }
  return parsed.data;
}

// ---------- Row types ----------

export type UserStatus = "active" | "on_leave" | "terminated";
export type VendorStatus = "active" | "pending_review" | "on_hold";
export type PaymentMethod = "EFT" | "CHEQUE" | "CARD";

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
  ruleType: "approval" | "payment_release" | "match";
  /** Free text in the CSV; the seed maps each rule to a structured row by hand. */
  condition: string;
  required: string;
  notes: string | null;
}

export interface GlAccountRow {
  accountNumber: string;
  name: string;
  accountType: "asset" | "expense" | "liability";
  notes: string | null;
}

export interface TaxCodeRow {
  code: TaxCode;
  description: string;
  rate: Decimal;
  appliesTo: "all" | "goods";
  recoverable: "yes" | "no" | "n/a";
  glAccount: string | null;
}

export interface VendorRow {
  vendorId: string;
  legalName: string;
  category: string;
  defaultGlAccount: string;
  address: string;
  provinceOrState: string;
  country: "CA" | "US";
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
  requestChannel: "email_request" | "phone_callback_verified" | "vendor_portal";
  verifiedByCallback: boolean;
  oldAccountLast4: string;
  newAccountLast4: string;
}

export interface ContractRow {
  contractId: string;
  vendorId: string;
  description: string;
  billingType: "fixed_monthly" | "rate_card" | "retainer" | "blanket";
  monthlyFee: Decimal | null;
  currency: Currency;
  hourlyRateCap: Decimal | null;
  /** As written in the CSV, e.g. 12 means 12%. */
  fuelSurchargeCapPct: Decimal | null;
  notToExceedMonthly: Decimal | null;
  startDate: IsoDate;
  endDate: IsoDate;
  autoRenew: boolean;
  status: "active" | "expired";
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
  status: "open" | "closed" | "partially_invoiced";
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
  status: "pending_approval" | "approved" | "scheduled" | "paid" | "rejected";
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
  approverRole: "dept_manager" | "finance_manager";
  action: "approved" | "rejected";
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
  status: "settled" | "outstanding" | "scheduled";
  preparedBy: string;
  releasedBy: string | null;
}

export interface BankStatementRow {
  bankTxnId: string;
  postedDate: IsoDate;
  description: string;
  debit: Decimal;
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
  source: "employee_card" | "ap_virtual_card";
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
  receivedAt: string;
  body: string;
  /** File names in incoming_invoices/. */
  attachments: string[];
}

// ---------- Loaders ----------

export function loadUsers(): UserRow[] {
  return readCsv("users.csv").map((r) => ({
    userId: str(r, "user_id"),
    fullName: str(r, "full_name"),
    email: str(r, "email"),
    title: str(r, "title"),
    departmentId: str(r, "department_id"),
    managerId: opt(r, "manager_id"),
    role: str(r, "role") as Role,
    approvalLimitCad: dec(r, "approval_limit_cad"),
    workProvince: str(r, "work_province") as Province,
    status: str(r, "status") as UserStatus,
    statusSince: opt(r, "status_since"),
    delegateUserId: opt(r, "delegate_user_id"),
    hireDate: str(r, "hire_date"),
  }));
}

export function loadDepartments(): DepartmentRow[] {
  return readCsv("departments.csv").map((r) => ({
    departmentId: str(r, "department_id"),
    name: str(r, "name"),
    costCentre: str(r, "cost_centre"),
    annualBudgetCad: dec(r, "annual_budget_cad"),
    managerUserId: str(r, "manager_user_id"),
  }));
}

export function loadApprovalPolicies(): ApprovalPolicyRow[] {
  return readCsv("approval_policies.csv").map((r) => ({
    ruleId: str(r, "rule_id"),
    ruleType: str(r, "rule_type") as ApprovalPolicyRow["ruleType"],
    condition: str(r, "condition"),
    required: str(r, "required"),
    notes: opt(r, "notes"),
  }));
}

export function loadGlAccounts(): GlAccountRow[] {
  return readCsv("gl_accounts.csv").map((r) => ({
    accountNumber: str(r, "account_number"),
    name: str(r, "name"),
    accountType: str(r, "account_type") as GlAccountRow["accountType"],
    notes: opt(r, "notes"),
  }));
}

export function loadTaxCodes(): TaxCodeRow[] {
  return readCsv("tax_codes.csv").map((r) => ({
    code: str(r, "code") as TaxCode,
    description: str(r, "description"),
    rate: dec(r, "rate"),
    appliesTo: str(r, "applies_to") as TaxCodeRow["appliesTo"],
    recoverable: str(r, "recoverable") as TaxCodeRow["recoverable"],
    glAccount: opt(r, "gl_account"),
  }));
}

export function loadVendors(): VendorRow[] {
  return readCsv("vendors.csv").map((r) => ({
    vendorId: str(r, "vendor_id"),
    legalName: str(r, "legal_name"),
    category: str(r, "category"),
    defaultGlAccount: str(r, "default_gl_account"),
    address: str(r, "address"),
    provinceOrState: str(r, "province_or_state"),
    country: str(r, "country") as VendorRow["country"],
    gstHstNumber: opt(r, "gst_hst_number"),
    qstNumber: opt(r, "qst_number"),
    paymentTermsDays: int(r, "payment_terms_days"),
    earlyPayDiscount: opt(r, "early_pay_discount"),
    preferredPaymentMethod: str(r, "preferred_payment_method") as PaymentMethod,
    acceptsCardPayment: yes(r, "accepts_card_payment"),
    bankInstitution: opt(r, "bank_institution"),
    bankTransit: opt(r, "bank_transit"),
    bankAccount: opt(r, "bank_account"),
    bankDetailsUpdatedAt: opt(r, "bank_details_updated_at"),
    apContactEmail: str(r, "ap_contact_email"),
    requiresPo: yes(r, "requires_po"),
    status: str(r, "status") as VendorStatus,
    onboardedAt: str(r, "onboarded_at"),
  }));
}

export function loadBankChanges(): BankChangeRow[] {
  return readCsv("bank_change_history.csv").map((r) => ({
    changeId: str(r, "change_id"),
    vendorId: str(r, "vendor_id"),
    changedAt: str(r, "changed_at"),
    changedByUserId: str(r, "changed_by_user_id"),
    requestChannel: str(r, "request_channel") as BankChangeRow["requestChannel"],
    verifiedByCallback: yes(r, "verified_by_callback"),
    oldAccountLast4: str(r, "old_account_last4"),
    newAccountLast4: str(r, "new_account_last4"),
  }));
}

export function loadContracts(): ContractRow[] {
  return readCsv("contracts.csv").map((r) => ({
    contractId: str(r, "contract_id"),
    vendorId: str(r, "vendor_id"),
    description: str(r, "description"),
    billingType: str(r, "billing_type") as ContractRow["billingType"],
    monthlyFee: optDec(r, "monthly_fee"),
    currency: str(r, "currency") as Currency,
    hourlyRateCap: optDec(r, "hourly_rate_cap"),
    fuelSurchargeCapPct: optDec(r, "fuel_surcharge_cap_pct"),
    notToExceedMonthly: optDec(r, "not_to_exceed_monthly"),
    startDate: str(r, "start_date"),
    endDate: str(r, "end_date"),
    autoRenew: yes(r, "auto_renew"),
    status: str(r, "status") as ContractRow["status"],
  }));
}

export function loadPurchaseOrders(): PurchaseOrderRow[] {
  return readCsv("purchase_orders.csv").map((r) => ({
    poId: str(r, "po_id"),
    vendorId: str(r, "vendor_id"),
    departmentId: str(r, "department_id"),
    requesterUserId: str(r, "requester_user_id"),
    issueDate: str(r, "issue_date"),
    description: str(r, "description"),
    totalAmount: dec(r, "total_amount"),
    currency: str(r, "currency") as Currency,
    status: str(r, "status") as PurchaseOrderRow["status"],
    approvedBy: str(r, "approved_by"),
  }));
}

export function loadInvoices(): InvoiceRow[] {
  return readCsv("invoices.csv").map((r) => ({
    invoiceId: str(r, "invoice_id"),
    vendorId: str(r, "vendor_id"),
    vendorInvoiceNumber: str(r, "vendor_invoice_number"),
    invoiceDate: str(r, "invoice_date"),
    receivedDate: str(r, "received_date"),
    dueDate: str(r, "due_date"),
    currency: str(r, "currency") as Currency,
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
    shipToProvince: str(r, "ship_to_province") as Province,
    status: str(r, "status") as InvoiceRow["status"],
  }));
}

export function loadInvoiceLines(): InvoiceLineRow[] {
  return readCsv("invoice_lines.csv").map((r) => ({
    invoiceId: str(r, "invoice_id"),
    lineNo: int(r, "line_no"),
    description: str(r, "description"),
    quantity: dec(r, "quantity"),
    unitPrice: dec(r, "unit_price"),
    amount: dec(r, "amount"),
    glAccount: str(r, "gl_account"),
    departmentId: str(r, "department_id"),
    gstHstCode: opt(r, "gst_hst_code") as TaxCode | null,
    pstQstCode: opt(r, "pst_qst_code") as TaxCode | null,
    lineType: str(r, "line_type") as LineType,
  }));
}

export function loadApprovals(): ApprovalRow[] {
  return readCsv("approvals.csv").map((r) => ({
    approvalId: str(r, "approval_id"),
    invoiceId: str(r, "invoice_id"),
    stepNo: int(r, "step_no"),
    approverUserId: str(r, "approver_user_id"),
    approverRole: str(r, "approver_role") as ApprovalRow["approverRole"],
    action: str(r, "action") as ApprovalRow["action"],
    actedAt: str(r, "acted_at"),
    comment: opt(r, "comment"),
  }));
}

export function loadPayments(): PaymentRow[] {
  return readCsv("payments.csv").map((r) => ({
    paymentId: str(r, "payment_id"),
    invoiceId: str(r, "invoice_id"),
    vendorId: str(r, "vendor_id"),
    method: str(r, "method") as PaymentMethod,
    scheduledDate: str(r, "scheduled_date"),
    paidDate: opt(r, "paid_date"),
    currency: str(r, "currency") as Currency,
    amount: dec(r, "amount"),
    fxRateToCad: dec(r, "fx_rate_to_cad"),
    amountCad: dec(r, "amount_cad"),
    discountTaken: dec(r, "discount_taken"),
    reference: str(r, "reference"),
    status: str(r, "status") as PaymentRow["status"],
    preparedBy: str(r, "prepared_by"),
    releasedBy: opt(r, "released_by"),
  }));
}

export function loadBankStatement(): BankStatementRow[] {
  return readCsv("bank_statement.csv").map((r) => ({
    bankTxnId: str(r, "bank_txn_id"),
    postedDate: str(r, "posted_date"),
    description: str(r, "description"),
    debit: dec(r, "debit"),
    credit: optDec(r, "credit"),
  }));
}

export function loadCardTransactions(): CardTransactionRow[] {
  return readCsv("card_transactions.csv").map((r) => ({
    txnId: str(r, "txn_id"),
    cardId: str(r, "card_id"),
    cardholderUserId: str(r, "cardholder_user_id"),
    postedDate: str(r, "posted_date"),
    merchantDescriptor: str(r, "merchant_descriptor"),
    mcc: str(r, "mcc"),
    amount: dec(r, "amount"),
    currency: str(r, "currency") as Currency,
    amountCad: dec(r, "amount_cad"),
    source: str(r, "source") as CardTransactionRow["source"],
    receiptAttached: yes(r, "receipt_attached"),
    memo: opt(r, "memo"),
  }));
}

export function loadFxRates(): FxRateRow[] {
  return readCsv("fx_rates.csv").map((r) => ({
    date: str(r, "date"),
    usdToCad: dec(r, "usd_to_cad"),
  }));
}

export function loadEmails(): EmailRow[] {
  const raw = JSON.parse(
    readFileSync(path.join(datasetDir(), "inbox", "emails.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  return raw.map((e) => ({
    emailId: String(e.email_id),
    fromName: String(e.from_name),
    fromAddress: String(e.from_address),
    toAddress: String(e.to_address),
    subject: String(e.subject),
    receivedAt: String(e.received_at),
    body: String(e.body),
    attachments: Array.isArray(e.attachments) ? e.attachments.map(String) : [],
  }));
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
