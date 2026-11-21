/**
 * Verifies every count in BUILD_PLAN "What the dataset holds" → "Tables" (plus a few facts from
 * "The people who matter to routing" and Resolution that the rules engine relies on).
 *
 * Run: `npx tsx scripts/verify-counts.ts` (exits 1 on any mismatch). Also run by Vitest.
 *
 * Lists incoming_invoices/ by name only; never opens a file in it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Dataset, datasetDir, loadDataset } from "../src/lib/dataset";

process.env.APP_TODAY ??= "2026-11-02";

export interface CountCheck {
  table: string;
  what: string;
  expected: string | number;
  actual: string | number;
  ok: boolean;
}

function countBy<T>(rows: readonly T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
}

/** Reads sealed_invoices.txt: one file name per line, `#` comments ignored. */
export function readSealedList(dir = datasetDir()): string[] {
  return readFileSync(path.join(dir, "sealed_invoices.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function verifyCounts(
  ds: Dataset,
  incomingFiles: string[],
  sealed: string[],
): CountCheck[] {
  const out: CountCheck[] = [];
  const eq = (table: string, what: string, expected: string | number, actual: string | number) =>
    out.push({ table, what, expected, actual, ok: expected === actual });
  const eqCounts = (table: string, what: string, expected: Record<string, number>, actual: Record<string, number>) => {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      eq(table, `${what} = ${k}`, expected[k] ?? 0, actual[k] ?? 0);
    }
  };

  // users
  eq("users", "rows", 40, ds.users.length);
  eqCounts("users", "role", { employee: 28, approver: 6, ap_clerk: 2, controller_admin: 2, finance_manager: 1, auditor: 1 },
    countBy(ds.users, (u) => u.role));

  // departments
  eq("departments", "rows", 8, ds.departments.length);
  const userIds = new Set(ds.users.map((u) => u.userId));
  eq("departments", "with a manager in users and a positive budget", 8,
    ds.departments.filter((d) => userIds.has(d.managerUserId) && d.annualBudgetCad.gt(0)).length);

  // approval_policies
  eq("approval_policies", "rows", 13, ds.approvalPolicies.length);
  const typeOf = (ids: string[]) => ids.map((id) => ds.approvalPolicies.find((p) => p.ruleId === id)?.ruleType ?? "missing");
  eq("approval_policies", "P01–P08 type", "approval", [...new Set(typeOf(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08"]))].join(","));
  eq("approval_policies", "P09–P11 type", "payment_release", [...new Set(typeOf(["P09", "P10", "P11"]))].join(","));
  eq("approval_policies", "P12–P13 type", "match", [...new Set(typeOf(["P12", "P13"]))].join(","));

  // gl_accounts
  eq("gl_accounts", "rows", 30, ds.glAccounts.length);
  const expenseAccounts = new Set(ds.glAccounts.filter((g) => g.accountType === "expense").map((g) => g.accountNumber));
  eq("gl_accounts", "expense accounts used by history lines", 25,
    new Set(ds.invoiceLines.map((l) => l.glAccount).filter((a) => expenseAccounts.has(a))).size);

  // tax_codes
  eq("tax_codes", "rows", 6, ds.taxCodes.length);
  eq("tax_codes", "codes", "EXEMPT,FOREIGN,GST5,HST13,PST7_BC,QST9975", ds.taxCodes.map((t) => t.code).sort().join(","));

  // vendors
  eq("vendors", "rows", 56, ds.vendors.length);
  eqCounts("vendors", "status", { active: 52, pending_review: 3, on_hold: 1 }, countBy(ds.vendors, (v) => v.status));
  eqCounts("vendors", "country", { CA: 52, US: 4 }, countBy(ds.vendors, (v) => v.country));
  const taxNos = ds.vendors.map((v) => v.gstHstNumber).filter((t): t is string => !!t);
  eq("vendors", "GST/HST numbers present (Resolution)", 51, taxNos.length);
  eq("vendors", "GST/HST numbers unique (Resolution)", 51, new Set(taxNos).size);

  // bank_change_history
  eq("bank_change_history", "rows", 9, ds.bankChanges.length);
  eqCounts("bank_change_history", "verified_by_callback", { yes: 8, no: 1 },
    countBy(ds.bankChanges, (b) => (b.verifiedByCallback ? "yes" : "no")));

  // contracts
  eq("contracts", "rows", 27, ds.contracts.length);
  eqCounts("contracts", "billing_type", { fixed_monthly: 17, rate_card: 5, retainer: 2, blanket: 3 },
    countBy(ds.contracts, (c) => c.billingType));
  eqCounts("contracts", "status", { active: 26, expired: 1 }, countBy(ds.contracts, (c) => c.status));
  eq("contracts", "vendors with more than one contract (Resolution: at most one)", 0,
    Object.values(countBy(ds.contracts, (c) => c.vendorId)).filter((n) => n > 1).length);

  // purchase_orders
  eq("purchase_orders", "rows", 52, ds.purchaseOrders.length);
  eqCounts("purchase_orders", "status", { closed: 45, open: 6, partially_invoiced: 1 }, countBy(ds.purchaseOrders, (p) => p.status));
  eqCounts("purchase_orders", "currency", { CAD: 52 }, countBy(ds.purchaseOrders, (p) => p.currency));

  // invoices
  eq("invoices", "rows", 426, ds.invoices.length);
  eqCounts("invoices", "status", { paid: 394, scheduled: 18, rejected: 12, approved: 2 }, countBy(ds.invoices, (i) => i.status));
  eqCounts("invoices", "currency", { CAD: 392, USD: 34 }, countBy(ds.invoices, (i) => i.currency));
  const maxTotal = ds.invoices.reduce((m, i) => (i.totalCad.gt(m) ? i.totalCad.toNumber() : m), 0);
  eq("invoices", "largest total_cad (people who matter)", "28377.22", maxTotal.toFixed(2));

  // invoice_lines
  eq("invoice_lines", "rows", 809, ds.invoiceLines.length);
  eqCounts("invoice_lines", "line_type", { services: 711, goods: 98 }, countBy(ds.invoiceLines, (l) => l.lineType));
  const perInvoice = Object.values(countBy(ds.invoiceLines, (l) => l.invoiceId));
  eq("invoice_lines", "invoices with lines", 426, perInvoice.length);
  eq("invoice_lines", "lines per invoice (min–max)", "1–7", `${Math.min(...perInvoice)}–${Math.max(...perInvoice)}`);

  // approvals
  eq("approvals", "rows", 474, ds.approvals.length);
  eqCounts("approvals", "action", { approved: 462, rejected: 12 }, countBy(ds.approvals, (a) => a.action));
  eqCounts("approvals", "approver_role", { dept_manager: 426, finance_manager: 48 }, countBy(ds.approvals, (a) => a.approverRole));

  // payments
  eq("payments", "rows", 415, ds.payments.length);
  eqCounts("payments", "method", { EFT: 326, CARD: 67, CHEQUE: 22 }, countBy(ds.payments, (p) => p.method));
  eqCounts("payments", "status", { settled: 377, outstanding: 20, scheduled: 18 }, countBy(ds.payments, (p) => p.status));
  const preparers = [...new Set(ds.payments.map((p) => p.preparedBy))].sort().join(",");
  eq("payments", "prepared_by set (people who matter)", "U004,U005", preparers);

  // U003 approved → released by U002 (44) or U001 (2)
  const u003Approved = new Set(ds.approvals.filter((a) => a.approverUserId === "U003" && a.action === "approved").map((a) => a.invoiceId));
  const released = ds.payments.filter((p) => u003Approved.has(p.invoiceId) && p.releasedBy);
  eq("payments", "released payments on invoices U003 approved", 46, released.length);
  eqCounts("payments", "releaser when U003 approved", { U002: 44, U001: 2 }, countBy(released, (p) => p.releasedBy ?? ""));

  // bank_statement
  eq("bank_statement", "rows", 354, ds.bankStatement.length);
  eq("bank_statement", "debit rows (all debits)", 354, ds.bankStatement.filter((b) => b.debit && !b.credit).length);

  // card_transactions
  eq("card_transactions", "rows", 590, ds.cardTransactions.length);
  eqCounts("card_transactions", "source", { employee_card: 526, ap_virtual_card: 64 }, countBy(ds.cardTransactions, (c) => c.source));

  // fx_rates
  eq("fx_rates", "rows", 306, ds.fxRates.length);
  const fxDates = ds.fxRates.map((f) => f.date).sort();
  eq("fx_rates", "date range", "2026-01-01 to 2026-11-02", `${fxDates[0]} to ${fxDates[fxDates.length - 1]}`);

  // incoming_invoices (names only)
  eq("incoming_invoices", "files", 56, incomingFiles.length);
  eqCounts("incoming_invoices", "extension", { pdf: 54, png: 2 },
    countBy(incomingFiles, (f) => path.extname(f).slice(1).toLowerCase()));
  eq("incoming_invoices", "sealed list entries", 15, sealed.length);
  eq("incoming_invoices", "sealed entries present in the folder", 15, sealed.filter((s) => incomingFiles.includes(s)).length);

  // emails
  eq("inbox/emails.open.json", "emails", 44, ds.emails.length);
  eqCounts("inbox/emails.open.json", "attachments per email", { "1": 39, "2": 1, "0": 4 },
    countBy(ds.emails, (e) => String(e.attachments.length)));
  const received = ds.emails.map((e) => e.receivedAt.slice(0, 10)).sort();
  eq("inbox/emails.open.json", "received range", "2026-10-20 to 2026-11-02", `${received[0]} to ${received[received.length - 1]}`);

  // people who matter
  const u = (id: string) => ds.users.find((x) => x.userId === id);
  eq("users", "U012 status / since / delegate", "on_leave 2026-10-20 U003",
    `${u("U012")?.status} ${u("U012")?.statusSince} ${u("U012")?.delegateUserId}`);
  eq("users", "U015 status / since", "terminated 2026-09-15", `${u("U015")?.status} ${u("U015")?.statusSince}`);
  eq("users", "U003 role / manager", "finance_manager U002", `${u("U003")?.role} ${u("U003")?.managerId}`);
  eq("users", "controller with no manager", "U001",
    ds.users.filter((x) => x.role === "controller_admin" && !x.managerId).map((x) => x.userId).join(","));

  return out;
}

function main() {
  const dir = datasetDir();
  const incoming = readdirSync(path.join(dir, "incoming_invoices")).filter((f) => !f.startsWith("."));
  const results = verifyCounts(loadDataset(), incoming, readSealedList(dir));
  const bad = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.table.padEnd(20)} ${r.what.padEnd(60)} expected ${r.expected}, got ${r.actual}`);
  }
  console.log(`\n${results.length - bad.length} of ${results.length} counts match BUILD_PLAN.`);
  if (bad.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) main();
