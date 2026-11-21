/**
 * History replay vs BUILD_PLAN "What is planted in the history".
 *
 * Run: `npx tsx scripts/history-replay.ts` (sets APP_TODAY=2026-11-02 itself; exits 1 on a mismatch).
 * Also run by Vitest (scripts/history-replay.test.ts).
 *
 * The planted table is written out below with the invoice ids BUILD_PLAN names. Rows BUILD_PLAN gives
 * only as counts (fee mismatches) are checked by count per vendor. Reconciliation rows belong to the
 * bank-reconciliation bonus, not to the checks engine, and are listed as out of scope.
 */
import path from "node:path";
import { loadDataset } from "../src/lib/dataset";
import { byCode, type Replay, replayHistory } from "../src/lib/rules/replay";

process.env.APP_TODAY ??= "2026-11-02";

export interface PlantedRow {
  mess: string;
  code: string;
  /** Invoice ids that must carry the flag (the later invoice of a pair). */
  invoices?: string[];
  /** Or: how many flags per vendor. */
  perVendor?: Record<string, number>;
  /** Related ids the flags must point at (card charges, originals). */
  related?: string[];
}

export const PLANTED: PlantedRow[] = [
  { mess: "Same vendor and invoice number entered twice (5 pairs)", code: "DUP_EXACT", invoices: ["AP-00026", "AP-00034", "AP-00224", "AP-00237", "AP-00407"], related: ["AP-00007", "AP-00023", "AP-00215", "AP-00219", "AP-00394"] },
  { mess: "Same invoice, reformatted number (2 pairs)", code: "DUP_NEAR", invoices: ["AP-00077", "AP-00155"], related: ["AP-00073", "AP-00136"] },
  { mess: "Paid by EFT and also on an employee card (6 charges)", code: "DUP_PAID_BY_CARD", related: ["CT-00017", "CT-00026", "CT-00318", "CT-00324", "CT-00383", "CT-00551"] },
  { mess: "Split to stay under $10,000 (2 groups)", code: "SPLIT_SUSPECTED", invoices: ["AP-00131", "AP-00207"], related: ["AP-00129", "AP-00200", "AP-00206"] },
  { mess: "…the Torque split had no PO though the vendor requires one", code: "PO_REQUIRED_MISSING", invoices: ["AP-00200", "AP-00206", "AP-00207"] },
  { mess: "Approver approved their own request (U010)", code: "SELF_APPROVAL", invoices: ["AP-00092", "AP-00178", "AP-00235"] },
  { mess: "Wrong tax for the province", code: "TAX_WRONG_FOR_PROVINCE", invoices: ["AP-00098", "AP-00253", "AP-00325"] },
  { mess: "Fixed monthly fee exceeded (13: Redstone 10, Aurora Mobile 1, Pinecone 2)", code: "CONTRACT_FEE_MISMATCH", perVendor: { V021: 10, V022: 1, V017: 2 } },
  { mess: "Monthly cap exceeded (C024 Feb, C027 Apr, C022 Jun)", code: "CONTRACT_MONTHLY_CAP", invoices: ["AP-00075", "AP-00155", "AP-00234"] },
  { mess: "Invoice above its PO (2, plus two POs billed twice)", code: "PO_OVER_BALANCE", invoices: ["AP-00159", "AP-00216", "AP-00224", "AP-00407"] },
  { mess: "Vendor on hold, still paid (2 invoices to V053)", code: "VENDOR_ON_HOLD", perVendor: { V053: 2 } },
  { mess: "Bank details changed without verification (AP-00426 for V004)", code: "BANK_CHANGE_UNVERIFIED", invoices: ["AP-00426"] },
  { mess: "Lookalike vendor records (invoices from the lesser record of each pair)", code: "VENDOR_LOOKALIKE", perVendor: { V051: 3, V053: 2 } },
];

/** Flags that are expected outside the planted table, with the reason (BUILD_PLAN asks for each difference to be explained). */
export const EXPLAINED: Record<string, string> = {
  VENDOR_NEW:
    "Replay artifact (route only, never a hold): history starts in January 2026 but every vendor was onboarded 2019–2024, so each vendor's first invoice in the replay has no approved invoice before it. With all of history known, only V052 and V054–V056 are new.",
  BANK_CHANGE_RECENT:
    "Information only: invoices dated within 30 days after one of the eight callback-verified bank changes. Shown to the approver, changes nothing.",
  CONTRACT_PERIOD_REPEAT:
    "Information only: AP-00026, the second GR26-2821 from V037 in January, which is itself the planted duplicate (DUP_EXACT) the approver rejected.",
};

export const OUT_OF_SCOPE = [
  "Cheques: 20 outstanding cheques cleared on the statement, one at $6,990.53 vs $6,990.48 (bank reconciliation bonus).",
  "Bank items with no payment: 10 monthly fees, 6 wire fees, 5 pre-authorised debits (bank reconciliation bonus).",
];

export interface Comparison {
  row: string;
  code: string;
  ok: boolean;
  expected: string;
  actual: string;
}

export function compareWithPlanted(replay: Replay): { rows: Comparison[]; unexplained: Array<{ invoiceId: string; code: string; message: string }>; lookalikePairsOk: boolean } {
  const codes = byCode(replay.results);
  const flagsOf = (code: string) => replay.results.flatMap((r) => r.flags.filter((f) => f.code === code).map((f) => ({ r, f })));
  const rows: Comparison[] = PLANTED.map((p) => {
    const got = codes.get(p.code) ?? [];
    let expected = "";
    let actual = "";
    if (p.invoices) {
      expected = [...p.invoices].sort().join(" ");
      actual = [...new Set(got)].sort().join(" ");
    } else if (p.perVendor) {
      expected = Object.entries(p.perVendor).sort().map(([v, n]) => `${v}×${n}`).join(" ");
      const per: Record<string, number> = {};
      for (const { r } of flagsOf(p.code)) per[r.vendorId ?? "?"] = (per[r.vendorId ?? "?"] ?? 0) + 1;
      actual = Object.entries(per).sort().map(([v, n]) => `${v}×${n}`).join(" ");
    }
    let ok = expected === actual;
    if (p.related) {
      const rel = [...new Set(flagsOf(p.code).flatMap(({ f }) => [...(f.related?.invoiceIds ?? []), ...(f.related?.cardTxnIds ?? [])]))].sort();
      const missing = p.related.filter((id) => !rel.includes(id));
      if (!p.invoices && !p.perVendor) {
        expected = [...p.related].sort().join(" ");
        actual = rel.join(" ");
        ok = expected === actual;
      } else if (missing.length) {
        ok = false;
        actual += ` (missing related: ${missing.join(" ")})`;
      }
    }
    return { row: p.mess, code: p.code, ok, expected, actual };
  });

  const plantedCodes = new Set(PLANTED.map((p) => p.code));
  const unexplained = replay.results.flatMap((r) =>
    r.flags.filter((f) => !plantedCodes.has(f.code) && !(f.code in EXPLAINED)).map((f) => ({ invoiceId: r.invoiceId, code: f.code, message: f.message })),
  );
  const pairs = replay.lookalikePairs.map(([a, b]) => `${a}/${b}`).join(" ");
  return { rows, unexplained, lookalikePairsOk: pairs === "V001/V051 V002/V053 V026/V052" };
}

function main() {
  const replay = replayHistory(loadDataset(), process.env.APP_TODAY!);
  const { rows, unexplained, lookalikePairsOk } = compareWithPlanted(replay);
  console.log(`History replay over ${replay.results.length} invoices (APP_TODAY=${process.env.APP_TODAY})\n`);
  for (const r of rows) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.code.padEnd(24)} ${r.row}`);
    if (!r.ok) console.log(`        expected ${r.expected}\n        got      ${r.actual}`);
  }
  console.log(`${lookalikePairsOk ? "ok  " : "FAIL"}  ${"VENDOR_LOOKALIKE pairs".padEnd(24)} ${replay.lookalikePairs.map((p) => p.join("/")).join(", ")}`);

  const counts = byCode(replay.results);
  console.log("\nOther flags, explained:");
  for (const [code, why] of Object.entries(EXPLAINED)) console.log(`  ${code} ×${counts.get(code)?.length ?? 0}: ${why}`);
  console.log("\nOut of Loop B's scope:");
  for (const o of OUT_OF_SCOPE) console.log(`  ${o}`);

  const holdsOutsidePlanted = replay.results.flatMap((r) =>
    r.flags.filter((f) => f.effect === "hold" && !PLANTED.some((p) => p.code === f.code)).map((f) => `${r.invoiceId} ${f.code}`),
  );
  console.log(`\nHold-level flags outside the planted table (false positives): ${holdsOutsidePlanted.length ? holdsOutsidePlanted.join(", ") : "none"}`);
  if (unexplained.length) {
    console.log("\nUnexplained flags:");
    for (const u of unexplained) console.log(`  ${u.invoiceId} ${u.code}: ${u.message}`);
  }
  const bad = rows.filter((r) => !r.ok).length + (lookalikePairsOk ? 0 : 1) + unexplained.length + holdsOutsidePlanted.length;
  console.log(bad ? `\n${bad} difference(s).` : `\nThe replay matches "What is planted": ${rows.length + 1} of ${rows.length + 1} rows.`);
  if (bad) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) main();
