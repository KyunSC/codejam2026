/**
 * Smart-coding accuracy (BUILD_PLAN "Smart coding"): trained on January to August, tested on September
 * and October. Prints the two numbers BUILD_PLAN asks for: account right on first suggestion, department
 * right on first suggestion.
 *
 * Run: `npx tsx scripts/coding-accuracy.ts` (sets APP_TODAY=2026-11-02 itself). Also run by Vitest.
 */
import path from "node:path";
import { type Dataset, loadDataset } from "../src/lib/dataset";
import { buildCodingModel, type CodingSource, suggestAccount } from "../src/lib/rules/coding";
import { loadHistory } from "../src/lib/rules/history";
import { buildRefs } from "../src/lib/rules/refs";
import { resolveDepartment } from "../src/lib/rules/resolve/fields";

process.env.APP_TODAY ??= "2026-11-02";

export interface Accuracy {
  trainInvoices: number;
  testInvoices: number;
  account: { right: number; of: number; bySource: Record<CodingSource, { right: number; of: number }> };
  /** Department on the first suggestion, per test line (lines carry their own department). */
  departmentLines: { right: number; of: number };
  /** The same per test invoice. */
  departmentInvoices: { right: number; of: number };
  misses: string[];
}

/** Invoices dated before `splitDate` train; those from it to `endDate` (exclusive) test. */
export function codingAccuracy(ds: Dataset, splitDate = "2026-09-01", endDate = "2026-11-01"): Accuracy {
  const { known } = loadHistory(ds);
  const train = known.filter((k) => k.invoiceDate! < splitDate);
  const test = known.filter((k) => k.invoiceDate! >= splitDate && k.invoiceDate! < endDate);
  const refs = buildRefs(ds, train, process.env.APP_TODAY!);
  const model = buildCodingModel(train);
  const acc: Accuracy = {
    trainInvoices: train.length,
    testInvoices: test.length,
    account: { right: 0, of: 0, bySource: { vendor_description: { right: 0, of: 0 }, vendor_default: { right: 0, of: 0 }, nearest_description: { right: 0, of: 0 }, none: { right: 0, of: 0 } } },
    departmentLines: { right: 0, of: 0 },
    departmentInvoices: { right: 0, of: 0 },
    misses: [],
  };
  for (const inv of test) {
    const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
    const po = inv.poId ? refs.purchaseOrders.get(inv.poId) ?? null : null;
    const dept = resolveDepartment(po, inv.vendorId, inv.shipToProvince, refs).departmentId;
    acc.departmentInvoices.of++;
    if (dept === inv.departmentId) acc.departmentInvoices.right++;
    for (const l of inv.lines) {
      const s = suggestAccount(l.description, vendor, model, refs);
      const ok = s.glAccount === l.glAccount;
      acc.account.of++;
      acc.account.bySource[s.source].of++;
      if (ok) {
        acc.account.right++;
        acc.account.bySource[s.source].right++;
      } else acc.misses.push(`${inv.invoiceId} "${l.description}": suggested ${s.glAccount} (${s.source}), actual ${l.glAccount}`);
      acc.departmentLines.of++;
      if (dept === l.departmentId) acc.departmentLines.right++;
    }
  }
  return acc;
}

const pctOf = (x: { right: number; of: number }) => `${x.right} of ${x.of} (${((100 * x.right) / Math.max(x.of, 1)).toFixed(1)}%)`;

function main() {
  const a = codingAccuracy(loadDataset());
  console.log(`Smart coding: trained on ${a.trainInvoices} invoices dated Jan–Aug 2026, tested on ${a.testInvoices} dated Sep–Oct 2026.\n`);
  console.log(`Account right on first suggestion:    ${pctOf(a.account)} lines`);
  console.log(`Department right on first suggestion: ${pctOf(a.departmentLines)} lines; ${pctOf(a.departmentInvoices)} invoices`);
  console.log("\nAccount by rule:");
  for (const [s, x] of Object.entries(a.account.bySource)) if (x.of) console.log(`  ${s.padEnd(20)} ${pctOf(x)}`);
  if (a.misses.length) {
    console.log("\nAccount misses:");
    for (const m of a.misses) console.log(`  ${m}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) main();
