import Link from "next/link";

export const money = (n: number | null | undefined, currency = "CAD") =>
  n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency, currencyDisplay: currency === "CAD" ? "symbol" : "code" });

export const date = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "—");
export const dateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function Card({ title, actions, children, className = "" }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-3">
          <h2 className="heading text-lg leading-none">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES = ["gray", "blue", "green", "gold", "red", "purple", "pink", "ink"] as const;
type Tone = (typeof TONES)[number];
const LEGACY: Record<string, Tone> = { amber: "gold", violet: "purple" };

export function Badge({ tone = "gray", children }: { tone?: Tone | "amber" | "violet"; children: React.ReactNode }) {
  return <span className={`chip chip--${LEGACY[tone] ?? tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  new: "blue", extracted: "gray", no_invoice: "gray", pending: "gold", pending_approval: "gold", waiting: "gray",
  approved: "green", scheduled: "blue", released: "purple", outstanding: "purple", settled: "green", paid: "green",
  rejected: "red", void: "gray", failed: "red", active: "green", pending_review: "gold", on_hold: "red", on_leave: "gold",
  terminated: "gray", open: "gold", resolved: "green", overridden: "gray", blocking: "red", warning: "gold", info: "blue",
};

export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{value.replace(/_/g, " ")}</Badge>;
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="tbl text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {rows.length === 0 && <p className="muted px-5 py-4 text-sm">{empty ?? "Nothing here."}</p>}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => <td className={className}>{children}</td>;

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="link">
      {children}
    </Link>
  );
}

export const btn = "btn btn--solid btn--sm";
export const btnLight = "btn btn--ghost btn--sm";
export const btnDanger = "btn btn--danger btn--sm";
export const input = "input";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="heading m-0 text-[32px] leading-none sm:text-[40px]">{children}</h1>
      {sub && <div className="muted mt-3 max-w-3xl text-[15px]">{sub}</div>}
    </div>
  );
}

export const PAGE_SIZE = 5;

export function pageParam(v: string | string[] | undefined) {
  const n = Number(typeof v === "string" ? v : 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// Previous / next links for one list; keeps the page's other query parameters.
export function Pager({ param, page, total, params, size = PAGE_SIZE }: { param: string; page: number; total: number; params: Record<string, string | string[] | undefined>; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== param) q.set(k, v);
    if (p > 1) q.set(param, String(p));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="muted num">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link href={href(page - 1)} scroll={false} className={btnLight}>← Previous</Link> : <span className={btnLight} aria-disabled="true">← Previous</span>}
        <span className="label num px-2 text-xs">Page {page} / {pages}</span>
        {page < pages ? <Link href={href(page + 1)} scroll={false} className={btnLight}>Next →</Link> : <span className={btnLight} aria-disabled="true">Next →</span>}
      </div>
    </div>
  );
}

// The Brim mark: a lowercase "b" in a dark tile with a red offset shadow, like the cards.
export function Mark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 place-items-center rounded-[5px] border-2 border-border text-[17px] leading-none font-bold"
      style={{ background: "var(--btn-bg)", color: "var(--btn-fg)", boxShadow: "3px 3px 0 var(--red)" }}
    >
      b
    </span>
  );
}
