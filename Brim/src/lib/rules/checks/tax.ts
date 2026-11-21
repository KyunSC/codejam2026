/**
 * Tax and currency checks (BUILD_PLAN Checks, and the "Expected tax, by bill-to province" table).
 *
 * | Bill-to | Services   | Goods            |
 * | ON      | HST 13%    | HST 13%          |
 * | AB      | GST 5%     | GST 5%           |
 * | BC      | GST 5%     | GST 5% + PST 7%  |
 * | QC      | GST + QST  | GST + QST        |
 * Insurance vendor: exempt. US vendor: no Canadian tax. The vendor's own province does not matter.
 */
import Decimal from "decimal.js";
import { config } from "../../config";
import type { VendorRow } from "../../dataset";
import type { Province, ResolvedInvoice, TaxCode } from "../../types";
import { ev, makeFlag, money, pct } from "../format";
import { PROVINCE_NAMES } from "../offices";
import type { Check } from "./reading";

type Charged = "HST13" | "GST5" | "PST7_BC" | "QST9975";
const CHARGEABLE: readonly Charged[] = ["HST13", "GST5", "PST7_BC", "QST9975"];
const NAME: Record<Charged, string> = { HST13: "HST", GST5: "GST", PST7_BC: "BC PST", QST9975: "QST" };

export interface ExpectedTax {
  /** Codes that must be charged. */
  codes: Set<Charged>;
  /** Codes whose presence cannot be decided (BC PST when a line type is unknown). */
  undecided: Set<Charged>;
  /** Why, in words. */
  basis: string;
}

/** The codes BUILD_PLAN's table expects for this invoice, or null when the province or vendor is unknown. */
export function expectedTax(inv: ResolvedInvoice, vendor: VendorRow | undefined): ExpectedTax | null {
  if (vendor && config.tax.exemptCategories.includes(vendor.category)) {
    return { codes: new Set(), undecided: new Set(), basis: `${vendor.category} is exempt` };
  }
  if (vendor?.country === "US") return { codes: new Set(), undecided: new Set(), basis: "a US vendor charges no Canadian tax" };
  const p: Province | null = inv.shipToProvince;
  if (!p) return null;
  const where = `billed to ${PROVINCE_NAMES[p]}`;
  switch (p) {
    case "ON":
      return { codes: new Set(["HST13"]), undecided: new Set(), basis: `${where}, where 13% HST applies` };
    case "AB":
      return { codes: new Set(["GST5"]), undecided: new Set(), basis: `${where}, where 5% GST applies` };
    case "QC":
      return { codes: new Set(["GST5", "QST9975"]), undecided: new Set(), basis: `${where}, where 5% GST and 9.975% QST apply` };
    case "BC": {
      const goods = inv.lines.some((l) => l.lineType === "goods");
      const unknown = inv.lines.some((l) => l.lineType === null);
      const codes = new Set<Charged>(["GST5"]);
      const undecided = new Set<Charged>();
      if (goods) codes.add("PST7_BC");
      else if (unknown) undecided.add("PST7_BC");
      return {
        codes,
        undecided,
        basis: goods
          ? `${where}, where 5% GST applies and 7% PST applies to the goods lines`
          : unknown
            ? `${where}, where 5% GST applies (PST depends on line types not yet known)`
            : `${where}, where 5% GST applies and services carry no PST`,
      };
    }
  }
}

/** The codes charged on the invoice: tax lines with a known code and a non-zero amount. */
function chargedCodes(inv: ResolvedInvoice): Set<Charged> {
  const out = new Set<Charged>();
  for (const t of inv.taxes) if (t.taxCode && CHARGEABLE.includes(t.taxCode as Charged) && !t.amount.isZero()) out.add(t.taxCode as Charged);
  return out;
}

const list = (codes: Iterable<Charged>) => [...codes].map((c) => NAME[c]).join(" + ") || "no tax";

/** TAX_WRONG_FOR_PROVINCE: the tax codes charged are not the ones the bill-to province (or vendor type) calls for. */
export const checkTaxWrongForProvince: Check = (inv, refs) => {
  if (inv.taxes.some((t) => t.taxCode === null)) return []; // an unknown label is a reading problem, not a tax error
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  const exp = expectedTax(inv, vendor);
  if (!exp) return [];
  const charged = chargedCodes(inv);
  const missing = [...exp.codes].filter((c) => !charged.has(c));
  const extra = [...charged].filter((c) => !exp.codes.has(c) && !exp.undecided.has(c));
  if (!missing.length && !extra.length) return [];
  const chargedText = inv.taxes.filter((t) => !t.amount.isZero()).map((t) => `${t.labelPrinted} ${money(t.amount, inv.currency)}`).join(", ") || "no tax";
  const parts = [missing.length ? `${list(missing)} missing` : "", extra.length ? `${list(extra)} not expected` : ""].filter(Boolean);
  return [
    makeFlag(
      "TAX_WRONG_FOR_PROVINCE",
      "policy",
      "hold",
      `Tax: this invoice is ${exp.basis}, so ${list(exp.codes)} is expected. The vendor charged ${chargedText} (${parts.join("; ")}).`,
      [
        ev("Expected tax", list(exp.codes), `bill-to ${inv.shipToProvince ?? "?"}${vendor ? `, vendor ${vendor.vendorId} ${vendor.category}/${vendor.country}` : ""}`),
        ev("Tax charged", chargedText, "invoice, tax lines"),
      ],
    ),
  ];
};

/** The base a tax applies to: all lines (QST on the pre-tax amount), or the goods lines only for BC PST. */
function taxBase(inv: ResolvedInvoice, code: Charged): Decimal | null {
  if (code === "PST7_BC") {
    if (inv.lines.some((l) => l.lineType === null || l.amount === null)) return null;
    return inv.lines.filter((l) => l.lineType === "goods").reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  }
  if (inv.subtotal) return inv.subtotal;
  if (inv.lines.length && inv.lines.every((l) => l.amount)) return inv.lines.reduce((s, l) => s.plus(l.amount!), new Decimal(0));
  return null;
}

/** TAX_AMOUNT: a tax the province calls for is charged, but its amount is not base × rate within the tolerance. */
export const checkTaxAmount: Check = (inv, refs) => {
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  const exp = expectedTax(inv, vendor);
  if (!exp) return [];
  return inv.taxes.flatMap((t) => {
    const code = t.taxCode as Charged | null;
    if (!code || !exp.codes.has(code)) return [];
    const rate = refs.taxCodes.get(code as TaxCode)?.rate;
    const base = taxBase(inv, code);
    if (!rate || !base) return [];
    const expected = base.mul(rate).toDecimalPlaces(2);
    if (expected.minus(t.amount).abs().lte(config.tolerance.taxCad)) return [];
    return [
      makeFlag(
        "TAX_AMOUNT",
        "data",
        "hold",
        `${NAME[code]} at ${pct(rate)} on ${money(base, inv.currency)} is ${money(expected, inv.currency)}, but the invoice charges ${money(t.amount, inv.currency)}.`,
        [ev(`${NAME[code]} expected`, money(expected, inv.currency), `${pct(rate)} × ${code === "PST7_BC" ? "goods lines" : "subtotal"}, tax_codes.csv ${code}`), ev(`${NAME[code]} charged`, money(t.amount, inv.currency), `invoice, "${t.labelPrinted}"`)],
      ),
    ];
  });
};

/** TAX_NOT_REGISTERED: a Canadian supplier charges no tax and shows no GST/HST number, here or on file. */
export const checkTaxNotRegistered: Check = (inv, refs) => {
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  if (vendor && (vendor.country === "US" || config.tax.exemptCategories.includes(vendor.category))) return [];
  if (chargedCodes(inv).size || inv.gstHstNumber || vendor?.gstHstNumber) return [];
  if (!inv.total) return [];
  const who = vendor ? `${vendor.legalName} (${vendor.vendorId})` : `"${inv.vendorName ?? "the vendor"}"`;
  return [
    makeFlag(
      "TAX_NOT_REGISTERED",
      "policy",
      "info",
      `${who} charges no GST/HST and has no GST/HST number on the invoice or on file, so it appears not to be registered; no input tax credit can be claimed.`,
      [ev("Tax charged", "none", "invoice, tax lines"), ev("GST/HST number", "none", vendor ? `invoice and vendors.csv ${vendor.vendorId}` : "invoice")],
    ),
  ];
};

/** CURRENCY_UNEXPECTED: the currency differs from the vendor's contract, or a Canadian vendor bills in USD. */
export const checkCurrencyUnexpected: Check = (inv, refs) => {
  const cur = inv.currencyResolved;
  const vendor = inv.vendorId ? refs.vendors.get(inv.vendorId) : undefined;
  if (!cur || !vendor) return [];
  const contract = inv.contractId ? refs.contracts.get(inv.contractId) : undefined;
  if (contract && contract.currency !== cur) {
    return [
      makeFlag(
        "CURRENCY_UNEXPECTED",
        "policy",
        "info",
        `The invoice is in ${cur}, but contract ${contract.contractId} with ${vendor.legalName} is in ${contract.currency}.`,
        [ev("Invoice currency", cur, "invoice, total label"), ev("Contract currency", contract.currency, `contracts.csv ${contract.contractId}`)],
        { contractIds: [contract.contractId] },
      ),
    ];
  }
  if (!contract && cur === "USD" && vendor.country === "CA") {
    return [
      makeFlag(
        "CURRENCY_UNEXPECTED",
        "policy",
        "info",
        `${vendor.legalName} is a Canadian vendor but billed in USD; every USD invoice in history is from a US vendor.`,
        [ev("Invoice currency", cur, "invoice, total label"), ev("Vendor country", vendor.country, `vendors.csv ${vendor.vendorId}`)],
      ),
    ];
  }
  return [];
};

export const TAX_CHECKS: Record<string, Check> = {
  TAX_WRONG_FOR_PROVINCE: checkTaxWrongForProvince,
  TAX_AMOUNT: checkTaxAmount,
  TAX_NOT_REGISTERED: checkTaxNotRegistered,
  CURRENCY_UNEXPECTED: checkCurrencyUnexpected,
};
