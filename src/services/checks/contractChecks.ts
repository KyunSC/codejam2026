import { one } from "@/lib/db";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

type Contract = {
  contract_id: string;
  monthly_fee: number | null;
  currency: string;
  hourly_rate_cap: number | null;
  fuel_surcharge_cap_pct: number | null;
  not_to_exceed_monthly: number | null;
  end_date: string | null;
  status: string;
};

export async function contractChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, db } = ctx;
  if (!d.contract_id) return [];
  const c = await one<Contract>("SELECT * FROM contracts WHERE contract_id=$1", [d.contract_id], db);
  if (!c) return [];
  const flags: Flag[] = [];
  const month = (d.invoice_date ?? "").slice(0, 7);

  // expired on the invoice's date: the contract's status today does not matter to an invoice dated while it ran
  if (c.end_date && d.invoice_date && d.invoice_date > c.end_date) {
    flags.push({ check_code: "contract_expired", category: "contract", severity: "warning", message: `Contract ${c.contract_id} ended ${c.end_date}; invoice dated ${d.invoice_date}.` });
  }

  if (c.monthly_fee != null && d.subtotal != null && Math.abs(d.subtotal - c.monthly_fee) > 0.005) {
    flags.push({
      check_code: "contract_fee_mismatch",
      category: "contract",
      severity: "warning",
      message: `Subtotal ${money(d.subtotal)} differs from the contract's monthly fee of ${money(c.monthly_fee)} (${c.contract_id}).`,
      evidence: { expected: c.monthly_fee, found: d.subtotal },
    });
  }
  if (c.monthly_fee != null && month) {
    const same = await one<{ invoice_id: string }>(
      "SELECT invoice_id FROM invoices WHERE contract_id=$1 AND to_char(invoice_date,'YYYY-MM')=$2 AND status NOT IN ('rejected','void') LIMIT 1",
      [c.contract_id, month],
      db,
    );
    if (same) {
      flags.push({ check_code: "contract_second_in_month", category: "contract", severity: "warning", message: `${same.invoice_id} already bills this contract for ${month}.`, related_invoice_id: same.invoice_id });
    }
  }

  // Fuel surcharge: its amount as a percentage of the shipment lines (every other line except detention and waiting time),
  // worked out from the amounts rather than read from the percentage printed on the line. In past invoices the printed
  // percentage reproduces from exactly those lines.
  const isFuel = (desc: string) => /fuel surcharge|surcharge (de )?carburant|suppl[ée]ment carburant/i.test(desc);
  const isWaiting = (desc: string) => /detention|waiting|attente|immobilisation/i.test(desc);
  const shipments = d.lines.filter((x) => !isFuel(x.description) && !isWaiting(x.description)).reduce((s, x) => s + x.amount, 0);
  for (const l of d.lines) {
    if (!isFuel(l.description) || c.fuel_surcharge_cap_pct == null || shipments <= 0) continue;
    const pct = Math.round((l.amount / shipments) * 10000) / 100;
    if (pct > c.fuel_surcharge_cap_pct) {
      flags.push({
        check_code: "fuel_surcharge_over_cap",
        category: "contract",
        severity: "warning",
        line_no: l.line_no,
        message: `Fuel surcharge ${money(l.amount)} is ${pct}% of the shipment lines (${money(shipments)}); the contract cap is ${c.fuel_surcharge_cap_pct}%.`,
        evidence: { expected: c.fuel_surcharge_cap_pct, found: pct },
      });
    }
  }
  for (const l of d.lines) {
    if (c.hourly_rate_cap != null && l.quantity > 1 && l.unit_price > c.hourly_rate_cap + 0.005) {
      flags.push({
        check_code: "hourly_rate_over_cap",
        category: "contract",
        severity: "warning",
        line_no: l.line_no,
        message: `Rate ${money(l.unit_price)}/h is above the contract cap of ${money(c.hourly_rate_cap)}/h.`,
        evidence: { expected: c.hourly_rate_cap, found: l.unit_price },
      });
    }
  }

  if (c.not_to_exceed_monthly != null && month) {
    const billed = await one<{ s: number }>(
      "SELECT COALESCE(SUM(subtotal),0) AS s FROM invoices WHERE contract_id=$1 AND to_char(invoice_date,'YYYY-MM')=$2 AND status NOT IN ('rejected','void')",
      [c.contract_id, month],
      db,
    );
    const total = (billed?.s ?? 0) + (d.subtotal ?? 0);
    if (total > c.not_to_exceed_monthly) {
      flags.push({
        check_code: "contract_monthly_limit",
        category: "contract",
        severity: "warning",
        message: `Billing for ${month} would reach ${money(total)}, above the contract's monthly limit of ${money(c.not_to_exceed_monthly)}.`,
        evidence: { expected: c.not_to_exceed_monthly, found: total },
      });
    }
  }
  return flags;
}
