import type { CheckContext, Flag } from "./types";

const STALE_DAYS = 60;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export async function dateChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, asOf } = ctx;
  const flags: Flag[] = [];
  if (!d.invoice_date) {
    flags.push({ check_code: "date_missing", category: "date", severity: "blocking", message: "No invoice date was read." });
    return flags;
  }
  if (d.invoice_date > asOf) {
    flags.push({ check_code: "date_future", category: "date", severity: "warning", message: `Invoice dated ${d.invoice_date}, after today (${asOf}).` });
  }
  if (d.due_date && d.due_date < d.invoice_date) {
    flags.push({ check_code: "due_before_invoice", category: "date", severity: "warning", message: `Due ${d.due_date}, before the invoice date ${d.invoice_date}.` });
  }
  const received = d.received_date ?? asOf;
  if (daysBetween(d.invoice_date, received) > STALE_DAYS) {
    flags.push({ check_code: "date_stale", category: "date", severity: "warning", message: `Invoice dated ${d.invoice_date}, ${daysBetween(d.invoice_date, received)} days before it was received.` });
  }
  return flags;
}
