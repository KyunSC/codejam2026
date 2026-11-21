/**
 * Shared contract between the pipeline (Loop A) and the rules engine (Loop B).
 * Source: BUILD_PLAN.md, sections Extraction, Normalisation, Resolution and Checks.
 *
 * Loop A produces `Extracted` and `NormalizedInvoice`.
 * Loop B consumes `NormalizedInvoice`, produces `ResolvedInvoice`, and returns `Flag[]`.
 *
 * Change rule: Loop A may only append. Loop B never edits this file; it writes any
 * missing field to Brim/progress/questions.md instead.
 */
import type Decimal from "decimal.js";

// ---------- Basics ----------

/**
 * A calendar date as `YYYY-MM-DD`. Dates are kept as strings to avoid timezone drift.
 * The alias accepts any string, so create values only through `toIsoDate()` (src/lib/today.ts)
 * or the dataset loaders, which both reject impossible dates.
 */
export type IsoDate = string;

export type Role =
  | "employee"
  | "ap_clerk"
  | "approver"
  | "finance_manager"
  | "controller_admin"
  | "auditor";

/** Harborline's four offices. Bill-to province decides the tax (BUILD_PLAN Resolution). */
export type Province = "ON" | "BC" | "AB" | "QC";

export type Currency = "CAD" | "USD";

export type TaxCode = "HST13" | "GST5" | "PST7_BC" | "QST9975" | "EXEMPT" | "FOREIGN";

export type LineType = "goods" | "services";

export type InvoiceKind = "invoice" | "credit_note";

export type InvoiceStatus =
  | "received"
  | "extracted"
  | "needs_review"
  | "coded"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "released"
  | "paid"
  | "rejected"
  | "on_hold"
  | "duplicate"
  | "void";

export type EmailLabel =
  | "invoice"
  | "credit_note"
  | "statement"
  | "payment_inquiry"
  | "missing_attachment"
  | "other";

// ---------- Extraction (model output, every value as printed) ----------

export interface Extracted {
  docType: "invoice" | "credit_note" | "statement" | "other";
  language: "en" | "fr";
  vendor: {
    name: string | null;
    address: string | null;
    gstHstNumber: string | null;
    qstNumber: string | null;
  };
  billTo: { name: string | null; address: string | null };
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  terms: string | null;
  poNumber: string | null;
  creditNoteRef: string | null;
  currency: string | null;
  lines: Array<{
    description: string;
    quantity: string | null;
    unitPrice: string | null;
    amount: string | null;
  }>;
  subtotal: string | null;
  taxes: Array<{ label: string; amount: string }>;
  total: string | null;
  remit: {
    institution: string | null;
    transit: string | null;
    account: string | null;
    text: string | null;
  };
  /** Anything else printed, e.g. a discount line. */
  notes: string[];
  /** Field names the model could not read. */
  unreadable: string[];
}

// ---------- Normalisation (code output) ----------

/**
 * Evidence for one field, computed in code (never reported by the model).
 * - confirmed: found in the PDF text layer, or closed by arithmetic
 * - not_in_text: a text layer exists but the value is not in it
 * - uncertain: two reads of a scan disagree
 * - unreadable: the model listed it as unreadable
 * - missing: not printed on the document
 */
export type FieldEvidence = "confirmed" | "not_in_text" | "uncertain" | "unreadable" | "missing";

/** A problem found while parsing, before any check runs. */
export interface ParseIssue {
  field: string;
  code: "DATE_AMBIGUOUS" | "AMOUNT_UNPARSEABLE" | "DATE_UNPARSEABLE" | "TAX_LABEL_UNKNOWN";
  raw: string;
  detail: string;
}

export interface NormalizedLine {
  lineNo: number;
  description: string;
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  amount: Decimal | null;
}

export interface NormalizedTax {
  labelPrinted: string;
  /** Null when the label maps to no known code (raises a ParseIssue). */
  taxCode: TaxCode | null;
  /** The rate printed beside the label, e.g. 0.13 from "HST (13%)". */
  ratePrinted: Decimal | null;
  amount: Decimal;
}

export interface NormalizedTerms {
  raw: string;
  netDays: number | null;
  discountPct: Decimal | null;
  discountDays: number | null;
}

export interface NormalizedInvoice {
  kind: InvoiceKind;
  language: "en" | "fr";
  /** SHA-256 of the source file. */
  fileSha256: string;
  /** Whether the PDF had a text layer to check values against. */
  hasTextLayer: boolean;
  receivedDate: IsoDate;
  emailId: string | null;
  senderAddress: string | null;
  senderName: string | null;

  vendorName: string | null;
  vendorAddress: string | null;
  gstHstNumber: string | null;
  qstNumber: string | null;
  billToAddress: string | null;

  /** As printed. */
  invoiceNumber: string | null;
  /** Upper case, letters and digits only, no leading zeros. */
  numberKey: string | null;
  /** Digits only, no leading zeros. */
  digitsKey: string | null;

  invoiceDate: IsoDate | null;
  dueDate: IsoDate | null;
  terms: NormalizedTerms | null;
  poNumber: string | null;
  creditNoteRef: string | null;
  /** From the total label, else null (Resolution falls back to the vendor's country). */
  currency: Currency | null;

  lines: NormalizedLine[];
  subtotal: Decimal | null;
  taxes: NormalizedTax[];
  total: Decimal | null;

  remit: {
    institution: string | null;
    transit: string | null;
    account: string | null;
    text: string | null;
  };
  notes: string[];

  /** Keyed by field path, e.g. "total", "invoiceDate", "lines.2.amount". */
  evidence: Record<string, FieldEvidence>;
  parseIssues: ParseIssue[];
  /** The model's raw answer, kept for review and audit. */
  extracted: Extracted;
}

// ---------- Resolution (rules engine output, input to the checks) ----------

/**
 * A line with the account and line type it resolves to. Line type decides BC PST
 * (BUILD_PLAN Resolution, "Line type"): from the account, except 5020 and 6630 where the
 * description's nearest match in history decides. Null when not yet known; a check that
 * needs it (TAX_WRONG_FOR_PROVINCE in BC) must not guess.
 */
export interface ResolvedLine extends NormalizedLine {
  /** GL account number, e.g. "6110". */
  glAccount: string | null;
  lineType: LineType | null;
  lineTypeSource: "account" | "description_match" | "clerk" | null;
}

export interface ResolvedInvoice extends NormalizedInvoice {
  /** Same lines as NormalizedInvoice, in the same order, with account and line type. */
  lines: ResolvedLine[];
  vendorId: string | null;
  /** How the vendor was found, for the review screen. */
  vendorMatchedBy: "tax_number" | "bank_account" | "name" | null;
  /** Offered when no vendor resolved; never chosen automatically. */
  vendorCandidates: string[];
  shipToProvince: Province | null;
  poId: string | null;
  /** Open POs that fit, when the vendor requires a PO and none is printed. */
  poSuggestions: string[];
  contractId: string | null;
  departmentId: string | null;
  requesterId: string | null;
  creditOfInvoiceId: string | null;
  /** Resolved currency (printed, else vendor country). */
  currencyResolved: Currency | null;
  fxRateToCad: Decimal | null;
  totalCad: Decimal | null;
}

// ---------- Flags ----------

export type FlagClass = "data" | "policy" | "fraud";
export type FlagEffect = "hold" | "route" | "info";

export type FlagCode =
  // reading and arithmetic
  | "UNREADABLE"
  | "FIELD_UNCERTAIN"
  | "ARITHMETIC_LINE"
  | "ARITHMETIC_SUBTOTAL"
  | "ARITHMETIC_TOTAL"
  | "DATE_ODD"
  | "DATE_AMBIGUOUS"
  | "TERMS_MISMATCH"
  | "FX_RATE_FALLBACK"
  | "SHIP_TO_UNKNOWN"
  // vendor
  | "VENDOR_UNKNOWN"
  | "VENDOR_PENDING"
  | "VENDOR_ON_HOLD"
  | "VENDOR_NEW"
  | "VENDOR_LOOKALIKE"
  | "TAX_NUMBER_MISMATCH"
  | "BANK_MISMATCH"
  | "BANK_CHANGE_UNVERIFIED"
  | "BANK_CHANGE_RECENT"
  // tax and currency
  | "TAX_WRONG_FOR_PROVINCE"
  | "TAX_AMOUNT"
  | "TAX_NOT_REGISTERED"
  | "CURRENCY_UNEXPECTED"
  // PO and contract
  | "PO_REQUIRED_MISSING"
  | "PO_NOT_FOUND"
  | "PO_VENDOR_MISMATCH"
  | "PO_CLOSED"
  | "PO_OVER_BALANCE"
  | "CONTRACT_EXPIRED"
  | "CONTRACT_FEE_MISMATCH"
  | "CONTRACT_RATE_OVER_CAP"
  | "CONTRACT_FUEL_OVER_CAP"
  | "CONTRACT_MONTHLY_CAP"
  | "CONTRACT_PERIOD_REPEAT"
  // people and patterns
  | "SPLIT_SUSPECTED"
  | "REQUESTER_TERMINATED"
  | "SELF_APPROVAL"
  | "CREDIT_NOTE_ORPHAN"
  // duplicates
  | "DUP_FILE"
  | "DUP_EXACT"
  | "DUP_NEAR"
  | "DUP_CONTENT"
  | "DUP_PAID_BY_CARD"
  // email (fraud bonus)
  | "SENDER_DOMAIN_MISMATCH"
  | "SENDER_LOOKALIKE_DOMAIN";

/** One side of a comparison: the value and where it came from. */
export interface EvidenceItem {
  label: string;
  value: string;
  /** e.g. "invoice, Total line", "vendors.csv V004", "contract C022". */
  source: string;
}

export interface Flag {
  code: FlagCode;
  klass: FlagClass;
  effect: FlagEffect;
  /** A full sentence with the numbers in it. */
  message: string;
  evidence: EvidenceItem[];
  /** Other records this flag points at, e.g. the suspected original invoice. */
  related?: {
    invoiceIds?: string[];
    vendorIds?: string[];
    cardTxnIds?: string[];
    poIds?: string[];
    contractIds?: string[];
  };
}

// ---------- Approval policy (BUILD_PLAN "Approval routing", appended by Loop A item 1.2) ----------

/** Approval step roles, ranked in this order. */
export type StepRole = "dept_manager" | "finance_manager" | "controller_admin" | "cfo";

/**
 * One condition of a policy rule. A rule's `when` list holds when every entry holds;
 * an empty list means "always". `any` holds when at least one of its entries holds
 * (P05 is "pending_review OR new"). `poPresent` is needed by P13 ("no PO is present").
 */
export type Condition =
  | { field: "totalCad"; op: "gt" | "lte"; value: number }
  | { field: "vendor.status"; op: "in"; value: string[] }
  | { field: "vendor.isNew"; op: "eq"; value: boolean }
  | { field: "vendor.category"; op: "in"; value: string[] }
  | { field: "vendor.requiresPo"; op: "eq"; value: boolean }
  | { field: "poPresent"; op: "eq"; value: boolean }
  | { field: "department"; op: "in"; value: string[] }
  /** An open or overridden flag code. */
  | { field: "flag"; op: "in"; value: string[] }
  | { any: Condition[] };

export type Effect =
  | { kind: "requireSteps"; steps: StepRole[] }
  | { kind: "hold"; flag: FlagCode }
  | { kind: "releaseBy"; roles: Role[]; maxCad: number | null }
  | { kind: "invariant"; name: "noSelfApproval" | "delegateWhenOnLeave" | "approverCannotRelease" };

export interface PolicyRule {
  id: string;
  type: "approval" | "payment_release" | "match";
  active: boolean;
  /** Locked rules (P07, P08, P11) are shown in the editor but cannot be switched off. */
  locked: boolean;
  when: Condition[];
  effect: Effect;
  /** The CSV's condition and requirement, kept for display. */
  sourceText: string;
  note: string;
}
