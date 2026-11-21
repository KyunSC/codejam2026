/**
 * History replay (BUILD_PLAN Testing → History replay): run the checks engine over the 426 history
 * invoices, each against the invoices entered before it, as if they arrived one by one.
 *
 * History stores final states, so two things are rebuilt "as of" each invoice:
 * - known invoices: only those entered earlier (`refsAsOf`);
 * - PO status: every closed PO in the dataset was closed by its own invoices, so a PO counts as open
 *   until its last history invoice has been entered. Otherwise every PO invoice would show PO_CLOSED.
 */
import type { Dataset, PurchaseOrderRow } from "../dataset";
import type { Flag } from "../types";
import { runChecks } from "./checks";
import { lookalikePairs } from "./checks/vendor";
import { loadHistory } from "./history";
import { buildRefs, type KnownInvoice, refsAsOf } from "./refs";

export interface ReplayResult {
  invoiceId: string;
  vendorId: string | null;
  status: string;
  flags: Flag[];
}

export interface Replay {
  results: ReplayResult[];
  /** Vendor-level finding: lookalike record pairs. */
  lookalikePairs: Array<[string, string]>;
}

export function replayHistory(ds: Dataset, today: string): Replay {
  const { known, resolved } = loadHistory(ds);
  const base = buildRefs(ds, known, today);
  const order = [...known].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.invoiceId.localeCompare(b.invoiceId));
  const lastUse = new Map<string, number>();
  order.forEach((k, i) => k.poId && lastUse.set(k.poId, i));

  const results: ReplayResult[] = [];
  let i = 0;
  for (const [k, refs] of refsAsOf(base, known)) {
    const po = k.poId ? base.purchaseOrders.get(k.poId) : undefined;
    let r = refs;
    if (po && po.status === "closed" && (lastUse.get(po.poId) ?? -1) >= i) {
      const pos = new Map(refs.purchaseOrders);
      pos.set(po.poId, { ...po, status: "open" } as PurchaseOrderRow);
      r = { ...refs, purchaseOrders: pos };
    }
    results.push({ invoiceId: k.invoiceId, vendorId: k.vendorId, status: k.status, flags: runChecks(resolved.get(k.invoiceId)!, r) });
    i++;
  }
  return { results, lookalikePairs: lookalikePairs(ds.vendors).map(([a, b]) => [a.vendorId, b.vendorId]) };
}

/** Flags by code → invoice ids. */
export function byCode(results: readonly ReplayResult[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of results) for (const f of r.flags) out.set(f.code, [...(out.get(f.code) ?? []), r.invoiceId]);
  return out;
}

export type { KnownInvoice };
