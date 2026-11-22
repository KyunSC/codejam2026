import path from "path";
import { readCsv } from "@/lib/csv";

let rates: { date: string; rate: number }[] | null = null;

function load() {
  rates ??= readCsv(path.join(process.env.DATASET_DIR!, "data", "fx_rates.csv"))
    .map((r) => ({ date: r.date, rate: parseFloat(r.usd_to_cad) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return rates;
}

// USD→CAD rate for a date: that day's rate, or the latest earlier one.
export function usdToCad(date: string): number | null {
  const all = load();
  let found: number | null = null;
  for (const r of all) {
    if (r.date <= date) found = r.rate;
    else break;
  }
  return found ?? all[0]?.rate ?? null;
}
