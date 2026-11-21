/**
 * Regression tests for the findings of the loop/rules code review. Each describe names the finding;
 * each has a case that would have gone wrong before the fix and one that behaves as before.
 */
import { describe, expect, it } from "vitest";
import { canRelease } from "../../auth/matrix";
import type { Role, ResolvedInvoice } from "../../types";
import { checkFieldUncertain } from "../checks/reading";
import { checkContractMonthlyCap } from "../checks/contract";
import { checkDupContent } from "../checks/dupes";
import { checkSplitSuspected, findSplit } from "../checks/people";
import { digitsKey, numberKey } from "../keys";
import { isDiscarded, type KnownInvoice, type Refs } from "../refs";
import { poRemaining, resolveFx, resolveProvince } from "../resolve/fields";
import { approvalThresholds, type PolicyRule, policyRulesFromCsv, releaseLimitFor } from "../routing/policy";
import { route, routingInputFor } from "../routing/route";
import { D, ds, fresh, history, inv, refs, refsWith, summary } from "./fixtures";

const rules = policyRulesFromCsv(ds.approvalPolicies);

/** A known invoice from `vendorId`, built on a history row. */
const piece = (invoiceId: string, vendorId: string, n: string, date: string, amount: string, over: Partial<KnownInvoice> = {}): KnownInvoice => ({
  ...history.known[0],
  invoiceId,
  vendorId,
  numberKey: n,
  digitsKey: n,
  invoiceDate: date,
  subtotal: D(amount),
  total: D(amount),
  totalCad: D(amount),
  status: "paid",
  requesterId: null,
  poId: null,
  kind: "invoice",
  ...over,
});
const refsOf = (known: KnownInvoice[], over: Partial<Refs> = {}): Refs => ({ ...refsWith(known), ...over });
const v029 = (amount: string) => fresh("V029", { invoiceNumber: "T-29", numberKey: "T29", digitsKey: "29", invoiceDate: "2026-10-28", totalCad: D(amount), total: D(amount) });

describe("1. limits come from the policy rules in force, not only config", () => {
  const lowered = rules.map((r): PolicyRule => {
    if (r.id === "P09" && r.effect.kind === "releaseBy") return { ...r, effect: { ...r.effect, maxCad: 50_000 } };
    if (r.id === "P01" || r.id === "P02") return { ...r, when: r.when.map((c) => (c.field === "totalCad" ? { ...c, value: 5_000 } : c)) };
    return r;
  });
  const fm = { userId: "U003", role: "finance_manager" as Role, departmentId: "D04" };

  it("seed thresholds and release limits match config", () => {
    expect(approvalThresholds(rules)).toEqual([10_000, 50_000, 250_000]);
    expect([releaseLimitFor("finance_manager", rules), releaseLimitFor("controller_admin", rules), releaseLimitFor("ap_clerk", rules)]).toEqual([100_000, Infinity, null]);
  });

  it.each([
    ["seed rules: finance manager may release $80,000", rules, true],
    ["P09 lowered to $50,000: finance manager may not", lowered, false],
  ])("%s", (_, rs, ok) => expect(canRelease(fm, [], 80_000, rs).ok).toBe(ok));

  it.each([
    ["seed rules: $3,000 + $3,000 is no split", rules, null],
    ["P01/P02 lowered to $5,000: $3,000 + $3,000 dodges it", lowered, 5_000],
  ])("%s", (_, rs, threshold) => {
    const r = refsOf([piece("B1", "V029", "281", "2026-10-27", "3000")], { policyRules: rs });
    expect(findSplit(v029("3000"), r)?.threshold ?? null).toBe(threshold);
  });
});

describe("2. discarded invoices (rejected, duplicate, void) use up nothing", () => {
  it.each([
    ["paid", false],
    ["rejected", true],
    ["duplicate", true],
    ["void", true],
  ])("status %s → discarded %s", (status, want) => expect(isDiscarded(status)).toBe(want));

  const po = [...refs.purchaseOrders.values()][0];
  it.each([
    ["a paid invoice uses up the PO", "paid", po.totalAmount.minus(1000)],
    ["a copy marked duplicate does not", "duplicate", po.totalAmount],
    ["a void invoice does not", "void", po.totalAmount],
  ])("%s", (_, status, want) => {
    const r = refsOf([piece("B1", po.vendorId, "1", "2026-10-01", "1000", { poId: po.poId, status })]);
    expect(poRemaining(po, r).toString()).toBe(want.toString());
  });

  it.each([
    ["paid $6,000 + this $5,000 is a split", "paid", ["SPLIT_SUSPECTED"]],
    ["a $6,000 marked duplicate + this $5,000 is not", "duplicate", []],
  ])("%s", (_, status, want) => {
    const r = refsOf([piece("B1", "V029", "281", "2026-10-27", "6000", { status })]);
    expect(checkSplitSuspected(v029("5000"), r).map((f) => f.code)).toEqual(want);
  });

  it.each([
    ["an earlier paid invoice counts toward the monthly cap", "paid", [{ code: "CONTRACT_MONTHLY_CAP", effect: "route" }]],
    ["an earlier void invoice does not", "void", []],
  ])("%s", (_, status, want) => {
    const cap = refs.contractByVendor.get("V008")!.notToExceedMonthly!;
    const r = refsOf([piece("B1", "V008", "1", "2026-10-02", cap.minus(100).toString(), { status })]);
    expect(summary(checkContractMonthlyCap(fresh("V008", { subtotal: D(500), invoiceDate: "2026-10-30" }), r))).toEqual(want);
  });
});

describe("3. parse issues other than DATE_AMBIGUOUS raise FIELD_UNCERTAIN", () => {
  const issue = (code: ResolvedInvoice["parseIssues"][number]["code"], field = "taxes[1]") => ({ field, code, raw: "TVK 9,975 %", detail: "no tax code" });
  it.each([
    ["unknown tax label", fresh("V012", { parseIssues: [issue("TAX_LABEL_UNKNOWN")] }), [{ code: "FIELD_UNCERTAIN", effect: "hold" }]],
    ["unparseable line amount", fresh("V012", { parseIssues: [issue("AMOUNT_UNPARSEABLE", "lines[2].amount")] }), [{ code: "FIELD_UNCERTAIN", effect: "hold" }]],
    ["ambiguous date has its own check", fresh("V012", { parseIssues: [issue("DATE_AMBIGUOUS", "invoiceDate")] }), []],
    ["no parse issues", fresh("V012"), []],
  ])("%s", (_, i, want) => expect(summary(checkFieldUncertain(i, refs))).toEqual(want));

  it("names the label and says the tax checks cannot test it", () =>
    expect(checkFieldUncertain(fresh("V012", { parseIssues: [issue("TAX_LABEL_UNKNOWN")] }), refs)[0].message).toMatch(/tax label .* "TVK 9,975 %"/));

  it("one flag per field: a missing total is not flagged twice", () =>
    expect(checkFieldUncertain(fresh("V012", { total: null, parseIssues: [issue("AMOUNT_UNPARSEABLE", "total")] }), refs)).toHaveLength(1));
});

describe("4. DUP_CONTENT with numbers that have no digits, or no number", () => {
  const k = history.known.find((x) => x.invoiceId === "AP-00330")!;
  const lines = inv("AP-00330").lines;
  const relabel = (printed: string | null) => refsOf(history.known.map((x) => (x === k ? { ...x, invoiceNumber: printed, numberKey: numberKey(printed), digitsKey: digitsKey(printed) } : x)));
  const copy = (printed: string | null) => inv("AP-00330", { invoiceNumber: printed, numberKey: numberKey(printed), digitsKey: digitsKey(printed), invoiceDate: k.invoiceDate, lines, fileSha256: "new" });
  it.each([
    ["INV-A then INV-B, same content", copy("INV-B"), relabel("INV-A"), ["DUP_CONTENT"]],
    ["no number on either, same content", copy(null), relabel(null), ["DUP_CONTENT"]],
    ["INV-A then INV-A is DUP_EXACT's case, not this one", copy("INV-A"), relabel("INV-A"), []],
  ])("%s", (_, i, r, want) => expect(checkDupContent(i, r).map((f) => f.code)).toEqual(want));
});

describe("5. every invoice past a limit is flagged, not only the one that crosses it", () => {
  it.each([
    ["the month is already over its cap: a later invoice is flagged", "2026-10-02", [{ code: "CONTRACT_MONTHLY_CAP", effect: "route" }]],
    ["last month was over its cap: this month is fresh", "2026-09-02", []],
  ])("%s", (_, date, want) => {
    const cap = refs.contractByVendor.get("V008")!.notToExceedMonthly!;
    const r = refsOf([piece("B1", "V008", "1", date, cap.plus(1000).toString())]);
    const flags = checkContractMonthlyCap(fresh("V008", { subtotal: D(500), invoiceDate: "2026-10-30" }), r);
    expect(summary(flags)).toEqual(want);
    if (flags.length) expect(flags[0].message).toMatch(/already over its limit/);
  });

  it.each([
    ["third part of a split ($6,000 + $5,000 + $3,000)", ["6000", "5000"], 10_000],
    ["two small invoices that stay under ($3,000 + $3,000)", ["3000"], null],
  ])("%s", (_, earlier, threshold) => {
    const r = refsOf(earlier.map((a, n) => piece(`B${n}`, "V029", `28${n}`, "2026-10-27", a)));
    expect(findSplit(v029("3000"), r)?.threshold ?? null).toBe(threshold);
  });
});

describe("6. accented French bill-to addresses resolve", () => {
  it.each([
    ["1250 boul. René-Lévesque O., Bureau 2200, Montréal (Québec) H3B 4W8", "QC"],
    ["1250 Rene-Levesque O, Bureau 2200, Montreal QC H3B 4W8", "QC"],
    ["12 Rue Inconnue, Trois-Rivières (Québec)", null],
  ])("%s → %s", (address, want) => expect(resolveProvince(address)).toBe(want));
});

describe("7. an unknown CAD total never routes as $0", () => {
  it("a USD invoice with no rate takes every amount step and is blocked", () => {
    const i = fresh("V012", { totalCad: null });
    const ri = routingInputFor(i, [], refsOf([]));
    expect(ri.totalCad).toBeNull();
    const r = route(ri, rules, refs);
    expect(r.steps.map((s) => s.role)).toEqual(["dept_manager", "finance_manager", "controller_admin", "cfo"]);
    expect(r.blocked[0]).toMatch(/CAD total is unknown/);
  });

  it("a known total routes as before", () => {
    const r = route(routingInputFor(fresh("V012"), [], refsOf([])), rules, refs);
    expect([r.steps.map((s) => s.role), r.blocked]).toEqual([["dept_manager"], []]);
  });
});

describe("8. delegates on leave who name each other make the step unresolvable", () => {
  const users = new Map(refs.users);
  const u012 = users.get("U012")!;
  users.set("U012", { ...u012, status: "on_leave", delegateUserId: "U020" });
  users.set("U020", { ...u012, userId: "U020", fullName: "Test Delegate", status: "on_leave", delegateUserId: "U012" });
  const looped = { ...refs, users, userList: [...users.values()] };
  const input = { totalCad: 1000, departmentId: "D07", requesterId: null, vendor: null, flags: [], overridden: [] };

  it("the loop is caught, the step has no one, and the invoice is blocked", () => {
    const r = route(input, rules, looped);
    expect(r.steps[0]).toMatchObject({ assignedToId: null, onBehalfOfId: null, unresolvable: expect.stringMatching(/round in a circle/) });
    expect(r.blocked).toHaveLength(1);
  });

  it("without the loop the delegate takes the step", () => expect(route(input, rules, refs).steps[0]).toMatchObject({ assignedToId: "U003", onBehalfOfId: "U012" }));
});

describe("9. a delegate replaced by their manager no longer acts on the absent person's behalf", () => {
  const input = { totalCad: 1000, departmentId: "D07", vendor: null, flags: [], overridden: [] };
  it.each([
    ["the delegate (U003) requested the invoice → their manager acts in their own name", "U003", { assignedToId: "U002", onBehalfOfId: null }],
    ["someone else requested it → the delegate acts for U012", null, { assignedToId: "U003", onBehalfOfId: "U012" }],
  ])("%s", (_, requesterId, want) => expect(route({ ...input, requesterId }, rules, refs).steps[0]).toMatchObject(want));
});

describe("10. a USD invoice outside the FX table uses the nearest rate and says so", () => {
  const first = refs.fxRates[0];
  it.each([
    ["dated before the first row", "2020-01-01", { rateDate: first.date, fallback: true }],
    ["dated on the first row", first.date, { rateDate: first.date, fallback: false }],
  ])("%s", (_, date, want) => expect(resolveFx("USD", date, refs)).toMatchObject(want));
});
