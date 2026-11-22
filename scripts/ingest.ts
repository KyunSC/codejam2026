// Sends the Harborline dataset through the app's API, the way users would enter it.
// Usage: npx tsx scripts/ingest.ts setup|history|inbox   (dev server must be running)
import { readFileSync } from "fs";
import path from "path";
import { parseCsv } from "../src/lib/csv";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DATA = path.join(process.env.DATASET_DIR ?? "/Users/ming/Downloads/brim_ap_dataset", "data");
const ORG = "ORG-HARBORLINE";
const ORG_GST = "100000001RT0001";

const csv = (name: string) => parseCsv(readFileSync(path.join(DATA, `${name}.csv`), "utf8"));
const num = (s: string) => (s === "" ? null : Number(s));
const yes = (s: string) => s === "yes";

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`);
  return json;
}
const login = (email: string) => call("POST", "/api/session", { email });
const records = (kind: string, rows: unknown[]) => call("POST", `/api/organizations/${ORG}/records`, { kind, rows });

// Policy rows P01–P13 as structured triggers. The dataset's condition column is free text.
const POLICY_MAP: Record<string, { trigger_type: string; trigger_value: number | null; step_role: string }> = {
  P01: { trigger_type: "always", trigger_value: null, step_role: "dept_manager" },
  P02: { trigger_type: "amount_over", trigger_value: 10000, step_role: "finance_manager" },
  P03: { trigger_type: "amount_over", trigger_value: 50000, step_role: "controller" },
  P04: { trigger_type: "amount_over", trigger_value: 250000, step_role: "cfo" },
  P05: { trigger_type: "vendor_pending", trigger_value: null, step_role: "finance_manager" },
  P06: { trigger_type: "vendor_category", trigger_value: null, step_role: "finance_manager" },
  P07: { trigger_type: "requester_is_approver", trigger_value: null, step_role: "manager" },
  P08: { trigger_type: "approver_on_leave", trigger_value: null, step_role: "delegate" },
  P09: { trigger_type: "payment_upto", trigger_value: 100000, step_role: "finance_manager" },
  P10: { trigger_type: "payment_over", trigger_value: 100000, step_role: "controller_admin" },
  P11: { trigger_type: "always", trigger_value: null, step_role: "not_approver" },
  P12: { trigger_type: "po_over_balance", trigger_value: null, step_role: "finance_manager" },
  P13: { trigger_type: "po_required", trigger_value: null, step_role: "hold" },
};

async function setup() {
  await login("ops@brim.example");
  await call("POST", "/api/organizations", { organization_id: ORG, legal_name: "Harborline Logistics Inc.", gst_hst_number: ORG_GST, base_currency: "CAD" });
  const depts = csv("departments");
  await records("departments", depts.map((d) => ({ department_id: d.department_id, name: d.name, cost_centre: d.cost_centre })));
  await records("users", csv("users").map((u) => ({ ...u, approval_limit_cad: num(u.approval_limit_cad), status_since: u.status_since || null })));
  await records("department_managers", depts.map((d) => ({ department_id: d.department_id, manager_user_id: d.manager_user_id })));
  await records("gl_accounts", csv("gl_accounts").map((g) => ({ account_number: g.account_number, name: g.name, account_type: g.account_type })));
  await records("approval_policies", csv("approval_policies").map((p) => ({ rule_id: p.rule_id, rule_type: p.rule_type, ...POLICY_MAP[p.rule_id], is_active: true })));
  await records("vendors", csv("vendors").map((v) => ({
    ...v, payment_terms_days: num(v.payment_terms_days), accepts_card_payment: yes(v.accepts_card_payment), requires_po: yes(v.requires_po),
    onboarded_at: v.onboarded_at || null, preferred_payment_method: v.preferred_payment_method || "EFT",
  })));
  await records("vendor_bank_changes", csv("bank_change_history").map((b) => ({
    change_id: b.change_id, vendor_id: b.vendor_id, requested_at: b.changed_at, requested_by: b.changed_by_user_id, request_channel: b.request_channel,
    new_account: b.new_account_last4, verified_by_callback: yes(b.verified_by_callback), status: "approved",
  })));
  await records("contracts", csv("contracts").map((c) => ({
    ...c, monthly_fee: num(c.monthly_fee), hourly_rate_cap: num(c.hourly_rate_cap), fuel_surcharge_cap_pct: num(c.fuel_surcharge_cap_pct),
    not_to_exceed_monthly: num(c.not_to_exceed_monthly), start_date: c.start_date || null, end_date: c.end_date || null,
  })));
  await records("purchase_orders", csv("purchase_orders").map((p) => ({ ...p, total_amount: num(p.total_amount), issue_date: p.issue_date || null })));
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
    const myLines = lines.filter((l) => l.invoice_id === inv.invoice_id);
    const gstCode = myLines.find((l) => l.gst_hst_code === "HST13" || l.gst_hst_code === "GST5")?.gst_hst_code;
    const pstCode = myLines.find((l) => l.pst_qst_code)?.pst_qst_code;
    const taxes = [
      ...(Number(inv.gst_hst_amount) && gstCode ? [{ label: TAX_LABEL[gstCode], rate: null, amount: Number(inv.gst_hst_amount) }] : []),
      ...(Number(inv.pst_qst_amount) && pstCode ? [{ label: TAX_LABEL[pstCode], rate: null, amount: Number(inv.pst_qst_amount) }] : []),
    ];
    const form = {
      document_type: Number(inv.total) < 0 ? "credit_note" : "invoice",
      vendor_name: v.legal_name, vendor_gst_hst_number: v.gst_hst_number || null, vendor_qst_number: v.qst_number || null,
      vendor_invoice_number: inv.vendor_invoice_number, invoice_date: inv.invoice_date, due_date: inv.due_date, received_date: inv.received_date,
      bill_to_name: "Harborline Logistics Inc.", bill_to_tax_number: ORG_GST, currency: inv.currency,
      subtotal: Number(inv.subtotal), taxes, total: Number(inv.total),
      lines: myLines.map((l) => ({
        line_no: Number(l.line_no), description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), amount: Number(l.amount),
        gl_account: l.gl_account, department_id: l.department_id, gst_hst_code: l.gst_hst_code || null, pst_qst_code: l.pst_qst_code || null,
        line_type: l.line_type, coding_status: "accepted",
      })),
      vendor_id: inv.vendor_id, ship_to_province: inv.ship_to_province, department_id: inv.department_id, requester_user_id: inv.requester_user_id,
      po_id: inv.po_id || null, contract_id: inv.contract_id || null,
      manual: ["vendor_id", "ship_to_province", "department_id", "requester_user_id", "po_id", "contract_id"],
    };
    const { raw_item_id } = await call("POST", "/api/raw-items", { form, submitted_by: inv.requester_user_id, received_at: inv.received_date, organization_id: ORG });
    const { parsed } = await call("POST", `/api/raw-items/${raw_item_id}/extract`);
    const h = {
      invoice_id: inv.invoice_id,
      status: inv.status,
      approvals: approvals.filter((a) => a.invoice_id === inv.invoice_id).map((a) => ({
        approval_id: a.approval_id, step_no: Number(a.step_no), approver_user_id: a.approver_user_id, action: a.action, acted_at: a.acted_at, comment: a.comment || null,
      })),
      payments: payments.filter((p) => p.invoice_id === inv.invoice_id).map((p) => ({
        payment_id: p.payment_id, method: p.method, scheduled_date: p.scheduled_date || null, paid_date: p.paid_date || null, currency: p.currency,
        amount: Number(p.amount), fx_rate_to_cad: Number(p.fx_rate_to_cad), amount_cad: Number(p.amount_cad), discount_taken: Number(p.discount_taken || 0),
        reference: p.reference, status: p.status, prepared_by: p.prepared_by || null, released_by: p.released_by || null,
      })),
    };
    await call("POST", `/api/parsed-invoices/${parsed[0]}/approve`, { history: h });
    if (++n % 50 === 0) console.log(`${n} history invoices`);
  }
  console.log(`history done: ${n}`);
}

async function inbox() {
  await login("jordan.okafor@harborline-logistics.example");
  console.log(await call("POST", "/api/raw-items/poll"));
}

const step = process.argv[2];
({ setup, history, inbox } as Record<string, () => Promise<void>>)[step]?.().catch((e) => {
  console.error(e);
  process.exit(1);
});
