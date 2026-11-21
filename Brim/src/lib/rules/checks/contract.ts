/**
 * Contract checks (BUILD_PLAN Checks). The contract is the vendor's (at most one per vendor).
 * Monthly sums use subtotals by invoice-date calendar month: history reproduces BUILD_PLAN's three
 * cap breaches ($15,727.70, $12,969.94, $24,937.05) only that way.
 */
import Decimal from "decimal.js";
import { config } from "../../config";
import type { ContractRow } from "../../dataset";
import type { ResolvedInvoice } from "../../types";
import { ev, makeFlag, money, pct } from "../format";
import { isDiscarded, type KnownInvoice, type Refs } from "../refs";
import type { Check } from "./reading";

const contractOf = (inv: ResolvedInvoice, refs: Refs): ContractRow | undefined =>
  inv.contractId ? refs.contracts.get(inv.contractId) : undefined;
const src = (c: ContractRow) => `contracts.csv ${c.contractId}`;
const month = (d: string) => d.slice(0, 7);

/** Earlier known invoices from the vendor in the same calendar month, not discarded (rejected, duplicate, void). */
function sameMonth(inv: ResolvedInvoice, refs: Refs): KnownInvoice[] {
  if (!inv.vendorId || !inv.invoiceDate) return [];
  const m = month(inv.invoiceDate);
  return (refs.invoicesByVendor.get(inv.vendorId) ?? []).filter(
    (k) => k.invoiceDate && month(k.invoiceDate) === m && !isDiscarded(k.status) && k.kind === "invoice",
  );
}

/** CONTRACT_EXPIRED: the invoice is dated after the vendor's contract ended (and it did not auto-renew into an active term). */
export const checkContractExpired: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c || !inv.invoiceDate || inv.invoiceDate <= c.endDate) return [];
  if (c.autoRenew && c.status === "active") return [];
  return [
    makeFlag(
      "CONTRACT_EXPIRED",
      "policy",
      "hold",
      `The invoice is dated ${inv.invoiceDate}, but contract ${c.contractId} ("${c.description}") ended on ${c.endDate} and is ${c.status}.`,
      [ev("Invoice date", inv.invoiceDate, "invoice"), ev("Contract end", `${c.endDate} (${c.status})`, src(c))],
      { contractIds: [c.contractId] },
    ),
  ];
};

/** CONTRACT_FEE_MISMATCH: a fixed monthly contract, and the subtotal is not the monthly fee. */
export const checkContractFeeMismatch: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c || c.billingType !== "fixed_monthly" || !c.monthlyFee || !inv.subtotal || inv.kind === "credit_note") return [];
  if (inv.subtotal.equals(c.monthlyFee)) return [];
  const earlier = (refs.invoicesByVendor.get(c.vendorId) ?? []).filter((k) => k.kind === "invoice" && k.subtotal && !k.subtotal.equals(c.monthlyFee!));
  const diff = inv.subtotal.minus(c.monthlyFee);
  return [
    makeFlag(
      "CONTRACT_FEE_MISMATCH",
      "policy",
      "route",
      `The subtotal is ${money(inv.subtotal, inv.currency)} but contract ${c.contractId} fixes the monthly fee at ${money(c.monthlyFee, c.currency)} (${diff.isPositive() ? "over" : "under"} by ${money(diff.abs(), inv.currency)}). ` +
        (earlier.length ? `${earlier.length} earlier invoice${earlier.length === 1 ? " was" : "s were"} also off the fee.` : "No earlier invoice was off the fee."),
      [ev("Invoice subtotal", money(inv.subtotal, inv.currency), "invoice"), ev("Monthly fee", money(c.monthlyFee, c.currency), src(c)), ev("Earlier invoices off the fee", earlier.length, "invoice history")],
      { contractIds: [c.contractId], invoiceIds: earlier.map((e) => e.invoiceId) },
    ),
  ];
};

/** CONTRACT_RATE_OVER_CAP: the contract caps the hourly rate and an hourly line (quantity above 1, or "hours") charges more. */
export const checkContractRateOverCap: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c?.hourlyRateCap) return [];
  return inv.lines.flatMap((l) => {
    if (!l.unitPrice) return [];
    const hourly = (l.quantity && l.quantity.gt(1)) || config.contracts.hourlyPattern.test(l.description);
    if (!hourly || l.unitPrice.lte(c.hourlyRateCap!)) return [];
    return [
      makeFlag(
        "CONTRACT_RATE_OVER_CAP",
        "policy",
        "hold",
        `Line ${l.lineNo} ("${l.description}") bills ${money(l.unitPrice, inv.currency)} an hour; contract ${c.contractId} caps the rate at ${money(c.hourlyRateCap, c.currency)}.`,
        [ev("Rate billed", money(l.unitPrice, inv.currency), `invoice, line ${l.lineNo}`), ev("Rate cap", money(c.hourlyRateCap, c.currency), src(c))],
        { contractIds: [c.contractId] },
      ),
    ];
  });
};

/** CONTRACT_FUEL_OVER_CAP: the fuel surcharge, as a percentage of the shipment lines, is above the contract's cap. */
export const checkContractFuelOverCap: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c?.fuelSurchargeCapPct) return [];
  const fuel = inv.lines.filter((l) => l.amount && config.contracts.fuelSurchargePattern.test(l.description));
  const base = inv.lines
    .filter((l) => l.amount && config.contracts.shipmentPattern.test(l.description))
    .reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  if (!fuel.length || base.isZero()) return [];
  const surcharge = fuel.reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  const charged = surcharge.div(base).mul(100);
  if (charged.lte(c.fuelSurchargeCapPct.plus(config.contracts.fuelPctTolerance))) return [];
  return [
    makeFlag(
      "CONTRACT_FUEL_OVER_CAP",
      "policy",
      "hold",
      `The fuel surcharge ${money(surcharge, inv.currency)} is ${pct(charged.div(100).toDecimalPlaces(4))} of the ${money(base, inv.currency)} in shipment lines; contract ${c.contractId} caps it at ${c.fuelSurchargeCapPct.toString()}%.`,
      [
        ev("Fuel surcharge", `${money(surcharge, inv.currency)} = ${charged.toFixed(2)}% of shipments`, "invoice, fuel surcharge and LTL shipment lines"),
        ev("Cap", `${c.fuelSurchargeCapPct.toString()}%`, src(c)),
      ],
      { contractIds: [c.contractId] },
    ),
  ];
};

/** CONTRACT_MONTHLY_CAP: with this invoice the vendor's calendar month is over the contract's not-to-exceed amount (every invoice from the one that crosses it on). */
export const checkContractMonthlyCap: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c?.notToExceedMonthly || !inv.subtotal || !inv.invoiceDate || inv.kind === "credit_note") return [];
  const earlier = sameMonth(inv, refs);
  const before = earlier.reduce((s, k) => s.plus(k.subtotal ?? 0), new Decimal(0));
  const after = before.plus(inv.subtotal);
  if (after.lte(c.notToExceedMonthly)) return [];
  return [
    makeFlag(
      "CONTRACT_MONTHLY_CAP",
      "policy",
      "route",
      `${before.gt(c.notToExceedMonthly) ? "The month was already over its limit; this invoice takes" : "This invoice brings"} ${month(inv.invoiceDate)} billing under contract ${c.contractId} to ${money(after, inv.currency)}, over the ${money(c.notToExceedMonthly, c.currency)} monthly limit` +
        (earlier.length ? ` (with ${earlier.map((e) => `${e.invoiceId} ${money(e.subtotal)}`).join(", ")}).` : "."),
      [ev("Month to date with this invoice", money(after, inv.currency), `invoice subtotals, ${month(inv.invoiceDate)}`), ev("Monthly limit", money(c.notToExceedMonthly, c.currency), src(c))],
      { contractIds: [c.contractId], invoiceIds: earlier.map((e) => e.invoiceId) },
    ),
  ];
};

/**
 * CONTRACT_PERIOD_REPEAT: a second invoice in one calendar month from a fixed-fee vendor. Information only:
 * fixed-fee vendors bill on a different day each month, so a second bill is usually the next one.
 */
export const checkContractPeriodRepeat: Check = (inv, refs) => {
  const c = contractOf(inv, refs);
  if (!c || c.billingType !== "fixed_monthly" || inv.kind === "credit_note") return [];
  const earlier = sameMonth(inv, refs);
  if (!earlier.length) return [];
  return [
    makeFlag(
      "CONTRACT_PERIOD_REPEAT",
      "policy",
      "info",
      `This is a second ${inv.invoiceDate!.slice(0, 7)} invoice under fixed monthly contract ${c.contractId}; ${earlier.map((e) => `${e.invoiceId} (${e.invoiceNumber}, ${e.invoiceDate})`).join(", ")} was already billed this month. Usually the next month's bill arriving early.`,
      [ev("Earlier this month", earlier.map((e) => e.invoiceId).join(", "), "invoice history"), ev("Billing", "fixed monthly", src(c))],
      { contractIds: [c.contractId], invoiceIds: earlier.map((e) => e.invoiceId) },
    ),
  ];
};

export const CONTRACT_CHECKS: Record<string, Check> = {
  CONTRACT_EXPIRED: checkContractExpired,
  CONTRACT_FEE_MISMATCH: checkContractFeeMismatch,
  CONTRACT_RATE_OVER_CAP: checkContractRateOverCap,
  CONTRACT_FUEL_OVER_CAP: checkContractFuelOverCap,
  CONTRACT_MONTHLY_CAP: checkContractMonthlyCap,
  CONTRACT_PERIOD_REPEAT: checkContractPeriodRepeat,
};
