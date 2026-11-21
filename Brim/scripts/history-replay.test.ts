import { describe, expect, it } from "vitest";
import { loadDataset } from "../src/lib/dataset";
import { ALL_CHECKS, hasHold, runChecks } from "../src/lib/rules/checks";
import { checkVendorNew } from "../src/lib/rules/checks/vendor";
import { loadHistory } from "../src/lib/rules/history";
import { buildRefs, withInvoices } from "../src/lib/rules/refs";
import { byCode, replayHistory } from "../src/lib/rules/replay";
import { today } from "../src/lib/today";
import { compareWithPlanted, EXPLAINED, PLANTED } from "./history-replay";

const ds = loadDataset();
const replay = replayHistory(ds, today());
const cmp = compareWithPlanted(replay);

describe("history replay vs BUILD_PLAN 'What is planted'", () => {
  it.each(cmp.rows.map((r) => [r.code, r]))("%s", (_, r) => {
    expect(r.actual, r.row).toBe(r.expected);
    expect(r.ok).toBe(true);
  });

  it("finds the three lookalike pairs", () => expect(cmp.lookalikePairsOk).toBe(true));

  it("raises no flag outside the planted table that is not explained", () => expect(cmp.unexplained).toEqual([]));

  it("raises no hold-level flag outside the planted table (no false positive holds)", () => {
    const planted = new Set(PLANTED.map((p) => p.code));
    const holds = replay.results.flatMap((r) => r.flags.filter((f) => f.effect === "hold" && !planted.has(f.code)).map((f) => `${r.invoiceId} ${f.code}`));
    expect(holds).toEqual([]);
  });

  it("every explained code is info or route only", () => {
    for (const r of replay.results) for (const f of r.flags) if (f.code in EXPLAINED) expect(f.effect, `${r.invoiceId} ${f.code}`).not.toBe("hold");
  });

  it("explanation check: with all of history known, only V052 and V054–V056 are new vendors", () => {
    const { known, resolved } = loadHistory(ds);
    const refs = buildRefs(ds, known, today());
    const newVendors = ds.vendors
      .filter((v) => {
        const sample = [...resolved.values()][0];
        return checkVendorNew({ ...sample, vendorId: v.vendorId }, refs).length > 0;
      })
      .map((v) => v.vendorId);
    expect(newVendors).toEqual(["V052", "V054", "V055", "V056"]);
  });

  it("explanation check: every BANK_CHANGE_RECENT in history is on a callback-verified change", () => {
    const verified = new Set(ds.bankChanges.filter((b) => b.verifiedByCallback).map((b) => b.changeId));
    const recent = replay.results.flatMap((r) => r.flags.filter((f) => f.code === "BANK_CHANGE_RECENT"));
    expect(recent.length).toBe(byCode(replay.results).get("BANK_CHANGE_RECENT")?.length);
    for (const f of recent) expect(verified.has(f.evidence[0].source.replace("bank_change_history ", ""))).toBe(true);
  });
});

describe("runChecks", () => {
  const { known, resolved } = loadHistory(ds);
  const refs = buildRefs(ds, known, today());

  it("covers every code in BUILD_PLAN's checks table, the duplicate layers and the email fraud checks", () => {
    expect(Object.keys(ALL_CHECKS).sort()).toEqual(
      [
        "UNREADABLE", "FIELD_UNCERTAIN", "ARITHMETIC_LINE", "ARITHMETIC_SUBTOTAL", "ARITHMETIC_TOTAL", "DATE_ODD", "DATE_AMBIGUOUS",
        "TERMS_MISMATCH", "FX_RATE_FALLBACK", "SHIP_TO_UNKNOWN", "VENDOR_UNKNOWN", "VENDOR_PENDING", "VENDOR_ON_HOLD", "VENDOR_NEW",
        "VENDOR_LOOKALIKE", "TAX_NUMBER_MISMATCH", "BANK_MISMATCH", "BANK_CHANGE_UNVERIFIED", "BANK_CHANGE_RECENT",
        "TAX_WRONG_FOR_PROVINCE", "TAX_AMOUNT", "TAX_NOT_REGISTERED", "CURRENCY_UNEXPECTED", "PO_REQUIRED_MISSING", "PO_NOT_FOUND",
        "PO_VENDOR_MISMATCH", "PO_CLOSED", "PO_OVER_BALANCE", "CONTRACT_EXPIRED", "CONTRACT_FEE_MISMATCH", "CONTRACT_RATE_OVER_CAP",
        "CONTRACT_FUEL_OVER_CAP", "CONTRACT_MONTHLY_CAP", "CONTRACT_PERIOD_REPEAT", "SPLIT_SUSPECTED", "REQUESTER_TERMINATED",
        "SELF_APPROVAL", "CREDIT_NOTE_ORPHAN", "DUP_EXACT", "DUP_NEAR", "DUP_CONTENT", "DUP_PAID_BY_CARD",
        // Bonus: fraud alerts on the email.
        "SENDER_DOMAIN_MISMATCH", "SENDER_LOOKALIKE_DOMAIN",
      ].sort(),
    );
  });

  /** Refs knowing every other history invoice, so an invoice is not compared with itself. */
  const others = (id: string) => withInvoices(refs, known.filter((k) => k.invoiceId !== id), { invoiceId: id });

  it("a clean invoice gets no hold; a wrong-tax one does", () => {
    expect(runChecks(resolved.get("AP-00001")!, others("AP-00001")).filter((f) => f.effect === "hold")).toEqual([]);
    expect(hasHold(runChecks(resolved.get("AP-00253")!, others("AP-00253")))).toBe(true);
    expect(runChecks(resolved.get("AP-00253")!, others("AP-00253")).map((f) => f.code)).toContain("TAX_WRONG_FOR_PROVINCE");
  });

  it("can run a subset", () => {
    expect(runChecks(resolved.get("AP-00253")!, others("AP-00253"), ["DUP_EXACT"])).toEqual([]);
    expect(runChecks(resolved.get("AP-00034")!, others("AP-00034"), ["DUP_EXACT"]).map((f) => f.code)).toEqual(["DUP_EXACT"]);
  });
});
