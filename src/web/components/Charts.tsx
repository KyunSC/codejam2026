import { Link } from "react-router-dom";

// Small one-series charts for the dashboard: one colour (no legend needed, the card title names the series),
// thin bars with rounded data ends, the value written beside or shown on hover.

type Row = { label: string; value: number; href?: string };

// Ranked horizontal bars: label, bar scaled to the largest value, value at the end.
export function BarList({ rows, format, empty }: { rows: Row[]; format: (n: number) => string; empty: string }) {
  if (!rows.length) return <p className="text-sm muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate">{r.href ? <Link to={r.href} className="link">{r.label}</Link> : r.label}</span>
          <span className="h-2 rounded-r bg-surface-2">
            <span className="block h-2 rounded-r" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: "var(--blue)" }} />
          </span>
          <span className="num whitespace-nowrap text-right">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

// Vertical bars over months (label YYYY-MM), the largest and the latest values written out, every value on hover.
export function MonthBars({ rows, format }: { rows: Row[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  const latest = rows[rows.length - 1];
  return (
    <div>
      <div className="mb-3 flex justify-between text-xs muted">
        <span>Highest {format(max)}</span>
        {latest && <span>{monthName(latest.label)} {format(latest.value)}</span>}
      </div>
      <div className="flex h-36 items-end gap-1 border-b-2 border-line">
        {rows.map((r) => (
          <div key={r.label} className="flex h-full flex-1 items-end" title={`${monthName(r.label)} ${r.label.slice(0, 4)}: ${format(r.value)}`}>
            <div className="w-full rounded-t" style={{ height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 2 : 0, background: "var(--blue)" }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] muted">
        {rows.map((r) => <span key={r.label} className="flex-1 text-center">{monthName(r.label)}</span>)}
      </div>
    </div>
  );
}
