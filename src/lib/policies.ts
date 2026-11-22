import { money } from "./format";

// A policy: for [type], when [field] [operator] [value], require [requirements]. Every type shares the same fields and requirements lists;
// the type picks which of them apply. Approval and PO match policies test an invoice, payment release policies a payment.
// On an invoice, a role becomes an approval step and "hold" holds the invoice; on a payment, a role is the lowest that may release it.
// Shared by the server and the settings page.

export type PolicyType = "approval" | "match" | "payment_release";
export type Operator = "<=" | ">" | "is" | "in" | "always";
export type Policy = {
  rule_id: string;
  rule_type: PolicyType;
  field: string;
  operator: Operator;
  value: string | null;
  required: string[];
  is_active: boolean;
};

export type Subject = "invoice" | "payment";

export const POLICY_TYPES: Record<PolicyType, { label: string; on: Subject }> = {
  approval: { label: "Approval", on: "invoice" },
  match: { label: "Purchase order match", on: "invoice" },
  payment_release: { label: "Payment release", on: "payment" },
};
type FieldKind = "amount" | "choice" | "fact";

export const FIELDS: Record<string, { label: string; type: PolicyType; kind: FieldKind; choices?: string[] }> = {
  any_invoice: { label: "Every invoice", type: "approval", kind: "fact" },
  invoice_total: { label: "Invoice total", type: "approval", kind: "amount" },
  vendor_status: { label: "Vendor status", type: "approval", kind: "choice", choices: ["active", "pending_review", "on_hold", "new"] },
  vendor_category: { label: "Vendor category", type: "approval", kind: "choice" },
  po_over_balance: { label: "Over purchase order balance", type: "match", kind: "fact" },
  po_missing: { label: "Purchase order missing", type: "match", kind: "fact" },
  any_payment: { label: "Every payment", type: "payment_release", kind: "fact" },
  payment_amount: { label: "Payment amount", type: "payment_release", kind: "amount" },
};

export const REQUIREMENTS: Record<string, { label: string; on: Subject[] }> = {
  dept_manager: { label: "Department manager", on: ["invoice"] },
  finance_manager: { label: "Finance manager", on: ["invoice", "payment"] },
  controller: { label: "Controller", on: ["invoice", "payment"] },
  cfo: { label: "CFO", on: ["invoice", "payment"] },
  hold: { label: "Hold", on: ["invoice"] },
  not_approver: { label: "Not an approver", on: ["payment"] },
};

// The roles in order of seniority, for payment release: a policy names the lowest that may release.
export const RELEASE_RANK = ["finance_manager", "controller", "cfo"];

export const OPERATORS: Record<Operator, string> = { "<=": "at most", ">": "over", is: "is", in: "is one of", always: "always" };

export const subjectOf = (p: Pick<Policy, "rule_type">): Subject | undefined => POLICY_TYPES[p.rule_type]?.on;

// Which operators make sense for a field.
export function operatorsFor(field: string): Operator[] {
  const kind = FIELDS[field]?.kind;
  if (kind === "amount") return ["<=", ">"];
  if (kind === "choice") return ["is", "in"];
  return ["always"];
}

// The facts a policy is tested against: amounts as numbers, choices as the set of values that apply, facts as true or false.
export type Facts = Record<string, number | string[] | boolean>;

export function matches(p: Policy, facts: Facts): boolean {
  const fact = facts[p.field];
  if (p.operator === "always") return fact === true;
  if (fact === undefined || p.value == null) return false;
  if (typeof fact === "number") return p.operator === "<=" ? fact <= Number(p.value) : p.operator === ">" ? fact > Number(p.value) : false;
  if (Array.isArray(fact)) {
    const wanted = p.operator === "in" ? p.value.split(",").map((v) => v.trim().toLowerCase()) : [p.value.trim().toLowerCase()];
    return fact.some((f) => wanted.includes(f.toLowerCase()));
  }
  return false;
}

// The condition in a few words: "Invoice total over $10,000", "Vendor status is one of pending review, new", "Every payment".
export function conditionText(p: Policy): string {
  const f = FIELDS[p.field];
  if (!f || f.kind === "fact") return f?.label ?? p.field;
  const value = f.kind === "amount" ? money(Number(p.value)) : (p.value ?? "").split(",").map((v) => v.trim().replace(/_/g, " ")).join(", ");
  return `${f.label} ${OPERATORS[p.operator]} ${value}`;
}

export const requiredLabels = (p: Policy) => p.required.map((r) => REQUIREMENTS[r]?.label ?? r);

// The policy in one line, for the audit log.
export const describe = (p: Policy) => `${conditionText(p)}: ${requiredLabels(p).join(", ")}`;

// Returns what is wrong with a policy, or null.
export function policyProblem(p: Partial<Policy>): string | null {
  const t = p.rule_type ? POLICY_TYPES[p.rule_type] : undefined;
  if (!t) return "Pick what the policy is for.";
  const f = p.field ? FIELDS[p.field] : undefined;
  if (!f || f.type !== p.rule_type) return `Pick a field for a ${t.label.toLowerCase()} policy.`;
  if (!p.operator || !operatorsFor(p.field!).includes(p.operator)) return "That comparison does not fit the field.";
  if (f.kind === "amount" && !(String(p.value ?? "").trim() !== "" && Number(p.value) >= 0)) return "Give the amount.";
  if (f.kind === "choice" && !String(p.value ?? "").trim()) return "Give the value to compare with.";
  if (!p.required?.length) return "Pick what the policy requires.";
  const wrong = p.required.find((r) => !REQUIREMENTS[r]?.on.includes(t.on));
  if (wrong) return `"${REQUIREMENTS[wrong]?.label ?? wrong}" does not apply to ${t.on === "invoice" ? "an invoice" : "a payment"}.`;
  return null;
}
