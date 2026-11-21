/**
 * Resolution of everything after the vendor (BUILD_PLAN Resolution): province, PO, contract,
 * department, requester, line type, currency and FX, credit-note target. Each is a small pure
 * function over the document and Refs.
 */
import Decimal from "decimal.js";
import type { PurchaseOrderRow } from "../../dataset";
import type { Currency, IsoDate, LineType, Province } from "../../types";
import { digitsKey, idKey, numberKey } from "../keys";
import { OFFICES } from "../offices";
import type { KnownInvoice, Refs } from "../refs";

// ---------- Province ----------

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The province of the bill-to address: one of Harborline's four offices. Matched on the full
 * address first, then on a province code standing alone, then on the city name. Anything else → null
 * (SHIP_TO_UNKNOWN; the clerk picks).
 */
export function resolveProvince(billToAddress: string | null): Province | null {
  if (!billToAddress) return null;
  const sq = squash(billToAddress);
  const exact = OFFICES.find((o) => sq.includes(squash(o.address)));
  if (exact) return exact.province;
  const upper = ` ${billToAddress.toUpperCase().replace(/[^A-Z0-9]/g, " ")} `;
  const byCode = OFFICES.filter((o) => upper.includes(` ${o.province} `));
  if (byCode.length === 1) return byCode[0].province;
  const byCity = OFFICES.filter((o) => upper.includes(` ${o.city.toUpperCase()} `));
  return byCity.length === 1 ? byCity[0].province : null;
}

// ---------- PO ----------

/** The PO row a printed PO number refers to, compared on letters and digits. */
export function findPo(printed: string | null, refs: Pick<Refs, "purchaseOrders">): PurchaseOrderRow | null {
  const key = idKey(printed);
  if (!key) return null;
  for (const po of refs.purchaseOrders.values()) if (idKey(po.poId) === key) return po;
  return null;
}

/** Invoices that consume a PO's balance: every known invoice on it except rejected ones. */
export function invoicesOnPo(poId: string, refs: Pick<Refs, "invoices">): KnownInvoice[] {
  return refs.invoices.filter((i) => i.poId === poId && i.status !== "rejected" && i.kind === "invoice");
}

/** PO amount (pre-tax) minus the subtotals already invoiced on it (P12). */
export function poRemaining(po: PurchaseOrderRow, refs: Pick<Refs, "invoices">): Decimal {
  return invoicesOnPo(po.poId, refs).reduce((left, i) => left.minus(i.subtotal ?? 0), new Decimal(po.totalAmount));
}

/** Open POs of the vendor whose remaining balance covers the subtotal, for a missing-PO invoice. */
export function suggestPos(
  vendorId: string | null,
  subtotal: Decimal | null,
  refs: Pick<Refs, "posByVendor" | "invoices">,
): string[] {
  if (!vendorId || !subtotal) return [];
  return (refs.posByVendor.get(vendorId) ?? [])
    .filter((po) => po.status !== "closed" && poRemaining(po, refs).gte(subtotal))
    .map((po) => po.poId);
}

// ---------- Department ----------

/**
 * Most frequent value; ties go to the value seen first in `oldestFirst` (the department the vendor
 * billed earliest). Left-one-out on history this reproduces BUILD_PLAN's 368 of 394 (vendor plus
 * province) and 375 of 425 (vendor alone); breaking ties by most recent gives 360 and 381.
 */
function mostFrequent(values: Array<string | null>, oldestFirst: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) {
    const bn = best ? counts.get(best)! : -1;
    if (n > bn || (n === bn && oldestFirst.indexOf(v) < oldestFirst.indexOf(best!))) best = v;
  }
  return best;
}

export interface DepartmentResolution {
  departmentId: string | null;
  source: "po" | "vendor_province" | "vendor" | null;
  reason: string;
}

/**
 * The PO's department; else the department this vendor billed most often to this province;
 * else the vendor's most frequent department; else none (the clerk picks).
 */
export function resolveDepartment(
  po: PurchaseOrderRow | null,
  vendorId: string | null,
  province: Province | null,
  refs: Pick<Refs, "invoicesByVendor">,
): DepartmentResolution {
  if (po) return { departmentId: po.departmentId, source: "po", reason: `From ${po.poId}.` };
  const past = vendorId ? [...(refs.invoicesByVendor.get(vendorId) ?? [])] : [];
  past.sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.invoiceId.localeCompare(b.invoiceId));
  const order = past.map((i) => i.departmentId ?? "");
  const sameProvince = past.filter((i) => province && i.shipToProvince === province);
  const byProvince = mostFrequent(sameProvince.map((i) => i.departmentId), order);
  if (byProvince) {
    const n = sameProvince.filter((i) => i.departmentId === byProvince).length;
    return {
      departmentId: byProvince,
      source: "vendor_province",
      reason: `${n} of ${sameProvince.length} past invoices from this vendor billed to ${province} went to ${byProvince}.`,
    };
  }
  const byVendor = mostFrequent(past.map((i) => i.departmentId), order);
  if (byVendor) {
    const n = past.filter((i) => i.departmentId === byVendor).length;
    return { departmentId: byVendor, source: "vendor", reason: `${n} of ${past.length} past invoices from this vendor went to ${byVendor}.` };
  }
  return { departmentId: null, source: null, reason: "No PO and no history for this vendor; the clerk picks the department." };
}

// ---------- Requester ----------

/**
 * The PO's requester, or the employee who uploaded. Otherwise empty: documents name no requester.
 * A terminated requester is kept here and reported by REQUESTER_TERMINATED; routing uses
 * `effectiveRequester` to reassign to their manager.
 */
export function resolveRequester(po: PurchaseOrderRow | null, uploaderId: string | null): string | null {
  return po?.requesterUserId ?? uploaderId ?? null;
}

/** A terminated requester is replaced by their manager (BUILD_PLAN Resolution → Requester). */
export function effectiveRequester(requesterId: string | null, refs: Pick<Refs, "users">): string | null {
  if (!requesterId) return null;
  const u = refs.users.get(requesterId);
  return u?.status === "terminated" ? (u.managerId ?? null) : requesterId;
}

// ---------- Line type ----------

export interface LineTypeModel {
  /** Account → the single line type history uses for it, or "mixed". */
  byAccount: Map<string, LineType | "mixed">;
  /** History lines on mixed accounts, for the nearest-description match. */
  mixedLines: Map<string, Array<{ words: Set<string>; lineType: LineType }>>;
}

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !/^\d+$/.test(w)),
  );
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}

/** Learns, from history lines, which accounts are all goods, all services, or mixed. */
export function buildLineTypeModel(
  lines: ReadonlyArray<{ glAccount: string | null; lineType: LineType | null; description: string }>,
): LineTypeModel {
  const seen = new Map<string, Set<LineType>>();
  for (const l of lines) {
    if (!l.glAccount || !l.lineType) continue;
    const s = seen.get(l.glAccount) ?? new Set<LineType>();
    s.add(l.lineType);
    seen.set(l.glAccount, s);
  }
  const byAccount = new Map<string, LineType | "mixed">();
  for (const [a, s] of seen) byAccount.set(a, s.size === 1 ? [...s][0] : "mixed");
  const mixedLines = new Map<string, Array<{ words: Set<string>; lineType: LineType }>>();
  for (const l of lines) {
    if (!l.glAccount || !l.lineType || byAccount.get(l.glAccount) !== "mixed") continue;
    const list = mixedLines.get(l.glAccount) ?? [];
    list.push({ words: words(l.description), lineType: l.lineType });
    mixedLines.set(l.glAccount, list);
  }
  return { byAccount, mixedLines };
}

/**
 * Goods or services, from the account the line is coded to. On an account history uses for both,
 * the line's nearest description in history on that account decides (most shared words; ties to
 * the more common type among the tied lines). Unknown account → null: a check must not guess.
 */
export function resolveLineType(
  glAccount: string | null,
  description: string,
  model: LineTypeModel,
): { lineType: LineType | null; source: "account" | "description_match" | null } {
  if (!glAccount) return { lineType: null, source: null };
  const t = model.byAccount.get(glAccount);
  if (!t) return { lineType: null, source: null };
  if (t !== "mixed") return { lineType: t, source: "account" };
  const w = words(description);
  let best = 0;
  let tied: LineType[] = [];
  for (const l of model.mixedLines.get(glAccount) ?? []) {
    const s = overlap(w, l.words);
    if (s > best) {
      best = s;
      tied = [l.lineType];
    } else if (s === best && s > 0) tied.push(l.lineType);
  }
  if (!tied.length) return { lineType: null, source: null };
  const goods = tied.filter((x) => x === "goods").length;
  if (goods * 2 === tied.length) return { lineType: null, source: null };
  return { lineType: goods * 2 > tied.length ? "goods" : "services", source: "description_match" };
}

// ---------- Currency and FX ----------

/** Printed currency, else the vendor's country (US → USD, otherwise CAD). */
export function resolveCurrency(printed: Currency | null, vendorCountry: string | null | undefined): Currency | null {
  if (printed) return printed;
  if (vendorCountry === "US") return "USD";
  if (vendorCountry === "CA") return "CAD";
  return null;
}

export interface FxResolution {
  rate: Decimal | null;
  /** The fx_rates date used. */
  rateDate: IsoDate | null;
  /** True when the invoice date is after the last row, so the last row was used (FX_RATE_FALLBACK). */
  fallback: boolean;
}

/** CAD → 1. USD → the fx_rates row for the invoice date; past the last row, the last row (fallback). */
export function resolveFx(currency: Currency | null, invoiceDate: IsoDate | null, refs: Pick<Refs, "fxRates">): FxResolution {
  if (currency === "CAD") return { rate: new Decimal(1), rateDate: null, fallback: false };
  if (currency !== "USD" || !invoiceDate || !refs.fxRates.length) return { rate: null, rateDate: null, fallback: false };
  const rows = refs.fxRates;
  const last = rows[rows.length - 1];
  if (invoiceDate > last.date) return { rate: last.usdToCad, rateDate: last.date, fallback: true };
  // Latest row on or before the date (the table is daily, so normally the date itself).
  let pick = rows[0];
  for (const r of rows) {
    if (r.date > invoiceDate) break;
    pick = r;
  }
  return { rate: pick.usdToCad, rateDate: pick.date, fallback: false };
}

// ---------- Credit note target ----------

/** The vendor's invoice a credit note's reference points to: same number key, else same digits key. */
export function resolveCreditTarget(
  creditNoteRef: string | null,
  vendorIds: readonly string[],
  refs: Pick<Refs, "invoicesByVendor">,
): string | null {
  const nk = numberKey(creditNoteRef);
  const dk = digitsKey(creditNoteRef);
  if (!nk && !dk) return null;
  const pool = vendorIds.flatMap((v) => refs.invoicesByVendor.get(v) ?? []).filter((i) => i.kind === "invoice");
  const exact = pool.filter((i) => nk && i.numberKey === nk);
  if (exact.length === 1) return exact[0].invoiceId;
  const digits = pool.filter((i) => dk && i.digitsKey === dk);
  return digits.length === 1 ? digits[0].invoiceId : null;
}
