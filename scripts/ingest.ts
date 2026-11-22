// Loads the Harborline dataset by calling the app's API, the way people would enter it.
// Usage (dev server running): npx tsx scripts/ingest.ts setup|history|inbox
import { readFileSync } from "fs";
import path from "path";
import { parseCsv } from "../src/lib/csv";

process.loadEnvFile(path.join(import.meta.dirname, "../.env.local"));
// Every loaded account gets this password (DEMO_PASSWORD in .env.local).
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) throw new Error("Set DEMO_PASSWORD in .env.local");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DATA = path.join(process.env.DATASET_DIR ?? "/Users/ming/Downloads/brim_ap_dataset", "data");
const ORG = "ORG-HARBORLINE";
const ORG_GST = "100000001RT0001";
const O = `/api/organizations/${ORG}`;

const csv = (name: string) => parseCsv(readFileSync(path.join(DATA, `${name}.csv`), "utf8"));
const num = (s: string) => (s === "" ? null : Number(s));
const yes = (s: string) => s === "yes";
const orNull = (s: string) => (s === "" ? null : s);

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const out = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${out.error}`);
  return out;
}
const login = (email: string) => call("POST", "/api/session", { email, password: PASSWORD });
const post = (url: string, body: unknown) => call("POST", O + url, body);
const patch = (url: string, body: unknown) => call("PATCH", O + url, body);

// The dataset's rules P01–P13 (free-text conditions) as: when [field] [operator] [value], require [required].
type PolicyShape = { rule_type: string; field: string; operator: string; value: string | null; required: string[] };
const POLICY_MAP: Record<string, PolicyShape> = {
  P01: { rule_type: "approval", field: "invoice_total", operator: "<=", value: "10000", required: ["dept_manager"] },
  P02: { rule_type: "approval", field: "invoice_total", operator: ">", value: "10000", required: ["dept_manager", "finance_manager"] },
  P03: { rule_type: "approval", field: "invoice_total", operator: ">", value: "50000", required: ["dept_manager", "finance_manager", "controller"] },
  P04: { rule_type: "approval", field: "invoice_total", operator: ">", value: "250000", required: ["dept_manager", "finance_manager", "controller", "cfo"] },
  P05: { rule_type: "approval", field: "vendor_status", operator: "in", value: "pending_review,new", required: ["finance_manager"] },
  P06: { rule_type: "approval", field: "vendor_category", operator: "is", value: "Legal", required: ["finance_manager"] },
  P09: { rule_type: "payment_release", field: "payment_amount", operator: "<=", value: "100000", required: ["finance_manager"] },
  P10: { rule_type: "payment_release", field: "payment_amount", operator: ">", value: "100000", required: ["controller"] },
  P11: { rule_type: "payment_release", field: "any_payment", operator: "always", value: null, required: ["not_approver"] },
  P12: { rule_type: "match", field: "po_over_balance", operator: "always", value: null, required: ["finance_manager"] },
  P13: { rule_type: "match", field: "po_missing", operator: "always", value: null, required: ["hold"] },
};

async function setup() {
  await login("ops@brim.example");
  await call("POST", "/api/organizations", { organization_id: ORG, legal_name: "Harborline Logistics Inc.", gst_hst_number: ORG_GST, base_currency: "CAD" });

  const depts = csv("departments");
  for (const d of depts) await post("/departments", { department_id: d.department_id, name: d.name, cost_centre: d.cost_centre });

  // users first without managers and delegates, who may not exist yet; then those links
  const users = csv("users");
  for (const u of users) {
    await post("/users", {
      user_id: u.user_id, full_name: u.full_name, email: u.email, title: u.title, department_id: u.department_id, role: u.role,
      approval_limit_cad: num(u.approval_limit_cad), work_province: u.work_province, status: u.status, status_since: orNull(u.status_since), password: PASSWORD,
    });
  }
  for (const u of users) {
    if (u.manager_id || u.delegate_user_id) await patch(`/users/${u.user_id}`, { manager_id: orNull(u.manager_id), delegate_user_id: orNull(u.delegate_user_id) });
  }
  for (const d of depts) await patch(`/departments/${d.department_id}`, { manager_user_id: d.manager_user_id });

  for (const g of csv("gl_accounts")) await post("/gl-accounts", { account_number: g.account_number, name: g.name, account_type: g.account_type });
  // P07 (requester → their manager) and P08 (on leave → delegate) are how every approval chain works, not policies
  for (const p of csv("approval_policies")) if (POLICY_MAP[p.rule_id]) await post("/policies", { rule_id: p.rule_id, ...POLICY_MAP[p.rule_id], is_active: true });

  for (const v of csv("vendors")) {
    await post("/vendors", {
      vendor_id: v.vendor_id, legal_name: v.legal_name, category: v.category, default_gl_account: v.default_gl_account, address: v.address,
      province_or_state: v.province_or_state, country: v.country, gst_hst_number: orNull(v.gst_hst_number), qst_number: orNull(v.qst_number),
      payment_terms_days: num(v.payment_terms_days), early_pay_discount: orNull(v.early_pay_discount), preferred_payment_method: v.preferred_payment_method || "EFT",
      accepts_card_payment: yes(v.accepts_card_payment), bank_institution: orNull(v.bank_institution), bank_transit: orNull(v.bank_transit),
      bank_account: orNull(v.bank_account), ap_contact_email: orNull(v.ap_contact_email), requires_po: yes(v.requires_po), status: v.status, onboarded_at: orNull(v.onboarded_at),
    });
  }
  for (const b of csv("bank_change_history")) {
    await post(`/vendors/${b.vendor_id}/bank-changes`, {
      change_id: b.change_id, account: b.new_account_last4, channel: b.request_channel, verified_by_callback: yes(b.verified_by_callback),
      requested_at: b.changed_at, requested_by: b.changed_by_user_id, status: "approved",
    });
  }
  for (const c of csv("contracts")) {
    await post("/contracts", {
      contract_id: c.contract_id, vendor_id: c.vendor_id, description: c.description, billing_type: c.billing_type, monthly_fee: num(c.monthly_fee),
      currency: c.currency, hourly_rate_cap: num(c.hourly_rate_cap), fuel_surcharge_cap_pct: num(c.fuel_surcharge_cap_pct),
      not_to_exceed_monthly: num(c.not_to_exceed_monthly), start_date: orNull(c.start_date), end_date: orNull(c.end_date), status: c.status,
    });
  }
  for (const p of csv("purchase_orders")) {
    await post("/purchase-orders", {
      po_id: p.po_id, vendor_id: p.vendor_id, department_id: p.department_id, requester_user_id: p.requester_user_id, issue_date: orNull(p.issue_date),
      description: p.description, total_amount: num(p.total_amount), currency: p.currency, status: p.status, approved_by: orNull(p.approved_by),
    });
  }
  console.log("setup done");
}

const TAX_LABEL: Record<string, string> = { HST13: "HST (13%)", GST5: "GST (5%)", QST9975: "QST (9.975%)", PST7_BC: "PST (7%)" };

async function history() {
  await login("ops@brim.example");
  const vendors = new Map(csv("vendors").map((v) => [v.vendor_id, v]));
  const lines = csv("invoice_lines");
  const approvals = csv("approvals");
  const payments = csv("payments");
  const invoices = csv("invoices").sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_id.localeCompare(b.invoice_id));
  let n = 0;
  for (const inv of invoices) {
    const v = vendors.get(inv.vendor_id)!;
    const mine = lines.filter((l) => l.invoice_id === inv.invoice_id);
    const gstCode = mine.find((l) => l.gst_hst_code === "HST13" || l.gst_hst_code === "GST5")?.gst_hst_code;
    const pstCode = mine.find((l) => l.pst_qst_code)?.pst_qst_code;
    const taxes = [
      ...(Number(inv.gst_hst_amount) && gstCode ? [{ label: TAX_LABEL[gstCode], rate: null, amount: Number(inv.gst_hst_amount) }] : []),
      ...(Number(inv.pst_qst_amount) && pstCode ? [{ label: TAX_LABEL[pstCode], rate: null, amount: Number(inv.pst_qst_amount) }] : []),
    ];
    await post("/invoice-imports", {
      submitted_by: inv.requester_user_id,
      received_at: inv.received_date,
      form: {
        document_type: Number(inv.total) < 0 ? "credit_note" : "invoice",
        vendor_name: v.legal_name, vendor_gst_hst_number: orNull(v.gst_hst_number), vendor_qst_number: orNull(v.qst_number),
        vendor_invoice_number: inv.vendor_invoice_number, invoice_date: inv.invoice_date, due_date: inv.due_date, received_date: inv.received_date,
        bill_to_name: "Harborline Logistics Inc.", bill_to_tax_number: ORG_GST, currency: inv.currency,
        subtotal: Number(inv.subtotal), taxes, total: Number(inv.total),
        lines: mine.map((l) => ({
          line_no: Number(l.line_no), description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), amount: Number(l.amount),
          gl_account: l.gl_account, department_id: l.department_id, gst_hst_code: orNull(l.gst_hst_code), pst_qst_code: orNull(l.pst_qst_code),
          line_type: l.line_type, coding_status: "accepted",
        })),
        vendor_id: inv.vendor_id, ship_to_province: inv.ship_to_province, department_id: inv.department_id, requester_user_id: inv.requester_user_id,
        po_id: orNull(inv.po_id), contract_id: orNull(inv.contract_id),
        manual: ["vendor_id", "ship_to_province", "department_id", "requester_user_id", "po_id", "contract_id"],
      },
      history: {
        invoice_id: inv.invoice_id,
        status: inv.status,
        approvals: approvals.filter((a) => a.invoice_id === inv.invoice_id).map((a) => ({
          approval_id: a.approval_id, step_no: Number(a.step_no), approver_user_id: a.approver_user_id, action: a.action, acted_at: a.acted_at, comment: orNull(a.comment),
        })),
        payments: payments.filter((p) => p.invoice_id === inv.invoice_id).map((p) => ({
          payment_id: p.payment_id, method: p.method, scheduled_date: orNull(p.scheduled_date), paid_date: orNull(p.paid_date), currency: p.currency,
          amount: Number(p.amount), fx_rate_to_cad: Number(p.fx_rate_to_cad), amount_cad: Number(p.amount_cad), discount_taken: Number(p.discount_taken || 0),
          reference: p.reference, status: p.status, prepared_by: orNull(p.prepared_by), released_by: orNull(p.released_by),
        })),
      },
    });
    if (++n % 100 === 0) console.log(`${n} history invoices`);
  }
  console.log(`history done: ${n}`);
}

async function inbox() {
  await login("jordan.okafor@harborline-logistics.example");
  console.log(await post("/raw-items/poll", {}));
}

const step = process.argv[2];
const steps: Record<string, () => Promise<void>> = { setup, history, inbox };
if (!steps[step]) {
  console.error("Usage: npx tsx scripts/ingest.ts setup|history|inbox");
  process.exit(1);
}
steps[step]().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
