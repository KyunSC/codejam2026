/**
 * Smart coding (BUILD_PLAN "Smart coding"). For each line, in order:
 *   1. The same description at this vendor in history → that account (the one real split: "Racking
 *      components" goes to 5030 at packaging vendors whose default is 5040).
 *   2. The vendor's default account (right on 799 of 809 history lines).
 *   3. Unknown vendor: the nearest description across all history by shared words.
 * Every suggestion carries its reason in words, shown beside the line.
 * Department follows Resolution (`resolveDepartment`).
 */
import type { VendorRow } from "../dataset";
import type { KnownInvoice, Refs } from "./refs";
import type { LineCoder } from "./resolve";
import { overlap, words } from "./resolve/fields";

export type CodingSource = "vendor_description" | "vendor_default" | "nearest_description" | "none";

export interface CodingSuggestion {
  glAccount: string | null;
  source: CodingSource;
  reason: string;
}

interface Counts {
  [account: string]: number;
}

export interface CodingModel {
  /** vendor → description key → account counts. */
  byVendorDescription: Map<string, Map<string, Counts>>;
  /** vendor → account counts over all its lines. */
  byVendor: Map<string, Counts>;
  /** Every history line, for the nearest-description fallback. */
  lines: Array<{ words: Set<string>; glAccount: string; vendorId: string | null }>;
}

/** Description key: its words (numbers and punctuation dropped), sorted, so "qty 120" and "qty 80" agree. */
export function descriptionKey(description: string): string {
  return [...words(description)].sort().join(" ");
}

const add = (c: Counts, a: string) => {
  c[a] = (c[a] ?? 0) + 1;
};
const top = (c: Counts): [string, number] | null => {
  let best: [string, number] | null = null;
  for (const [a, n] of Object.entries(c)) if (!best || n > best[1] || (n === best[1] && a < best[0])) best = [a, n];
  return best;
};
const total = (c: Counts) => Object.values(c).reduce((s, n) => s + n, 0);

export function buildCodingModel(invoices: readonly KnownInvoice[]): CodingModel {
  const byVendorDescription = new Map<string, Map<string, Counts>>();
  const byVendor = new Map<string, Counts>();
  const lines: CodingModel["lines"] = [];
  for (const inv of invoices) {
    for (const l of inv.lines) {
      if (!l.glAccount) continue;
      lines.push({ words: words(l.description), glAccount: l.glAccount, vendorId: inv.vendorId });
      if (!inv.vendorId) continue;
      const vd = byVendorDescription.get(inv.vendorId) ?? new Map<string, Counts>();
      const key = descriptionKey(l.description);
      const c = vd.get(key) ?? {};
      add(c, l.glAccount);
      vd.set(key, c);
      byVendorDescription.set(inv.vendorId, vd);
      const vc = byVendor.get(inv.vendorId) ?? {};
      add(vc, l.glAccount);
      byVendor.set(inv.vendorId, vc);
    }
  }
  return { byVendorDescription, byVendor, lines };
}

const cache = new WeakMap<readonly KnownInvoice[], CodingModel>();
/** The coding model for the invoices known in `refs`, built once per invoice list. */
export function codingModelFor(refs: Pick<Refs, "invoices">): CodingModel {
  let m = cache.get(refs.invoices);
  if (!m) {
    m = buildCodingModel(refs.invoices);
    cache.set(refs.invoices, m);
  }
  return m;
}

function accountName(account: string, refs: Pick<Refs, "glAccounts">): string {
  return `${account} ${refs.glAccounts.get(account)?.name ?? ""}`.trim();
}

/** The suggested account for one line, with the reason. */
export function suggestAccount(
  description: string,
  vendor: VendorRow | undefined,
  model: CodingModel,
  refs: Pick<Refs, "glAccounts">,
): CodingSuggestion {
  if (vendor) {
    const seen = model.byVendorDescription.get(vendor.vendorId)?.get(descriptionKey(description));
    const best = seen ? top(seen) : null;
    if (best && best[0] !== vendor.defaultGlAccount) {
      return {
        glAccount: best[0],
        source: "vendor_description",
        reason: `${vendor.legalName}: ${best[1]} of ${total(seen!)} past "${description}" lines coded ${accountName(best[0], refs)} (same description at this vendor; the vendor default is ${vendor.defaultGlAccount}).`,
      };
    }
    const all = model.byVendor.get(vendor.vendorId) ?? {};
    const n = all[vendor.defaultGlAccount] ?? 0;
    return {
      glAccount: vendor.defaultGlAccount,
      source: "vendor_default",
      reason: total(all)
        ? `${vendor.legalName}: ${n} of ${total(all)} past lines coded ${accountName(vendor.defaultGlAccount, refs)} (vendor default).`
        : `${vendor.legalName}: no past lines; using the vendor default ${accountName(vendor.defaultGlAccount, refs)}.`,
    };
  }
  const w = words(description);
  let bestScore = 0;
  const tied: Counts = {};
  for (const l of model.lines) {
    const s = overlap(w, l.words);
    if (s > bestScore) {
      bestScore = s;
      for (const k of Object.keys(tied)) delete tied[k];
      add(tied, l.glAccount);
    } else if (s === bestScore && s > 0) add(tied, l.glAccount);
  }
  const best = top(tied);
  if (!best) return { glAccount: null, source: "none", reason: "Unknown vendor and no past line shares a word with this description; the clerk picks the account." };
  return {
    glAccount: best[0],
    source: "nearest_description",
    reason: `Unknown vendor: the closest past descriptions (${Math.round(bestScore * 100)}% words shared) were coded ${accountName(best[0], refs)} on ${best[1]} of ${total(tied)} lines.`,
  };
}

/** A LineCoder for `resolveInvoice`, using the smart-coding order above. */
export const smartCoder: LineCoder = (line, vendorId, refs) =>
  suggestAccount(line.description, vendorId ? refs.vendors.get(vendorId) : undefined, codingModelFor(refs), refs).glAccount;
