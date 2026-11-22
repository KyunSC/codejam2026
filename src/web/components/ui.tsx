import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ApiError, type Loaded } from "../api";

// A date column (YYYY-MM-DD) as it is; a timestamp as its date where the user is.
export const date = (s: string | null | undefined) => (!s ? "—" : String(s).length <= 10 ? String(s) : new Date(s).toLocaleDateString("en-CA"));
export const dateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "—");

// headerProps: extra attributes for the header, e.g. the drag listeners when a card is moved by its header while customizing.
export function Card({ title, actions, children, className = "", id, headerProps }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string; headerProps?: React.HTMLAttributes<HTMLElement> }) {
  return (
    <section id={id} className={`card scroll-mt-28 ${className}`}>
      {(title || actions) && (
        <header {...headerProps} className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-3">
          <h2 className="heading text-lg leading-none">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = "gray" | "blue" | "green" | "gold" | "red" | "purple" | "pink" | "ink";
const LEGACY: Record<string, Tone> = { amber: "gold", violet: "purple" };

export function Badge({ tone = "gray", children }: { tone?: Tone | "amber" | "violet"; children: React.ReactNode }) {
  return <span className={`chip chip--${LEGACY[tone] ?? tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  new: "blue", extracted: "gray", no_invoice: "gray", pending: "gold", pending_approval: "gold", waiting: "gray",
  approved: "green", scheduled: "blue", released: "purple", outstanding: "purple", settled: "green", paid: "green",
  rejected: "red", void: "gray", cancelled: "gray", failed: "red", active: "green", pending_review: "gold", on_hold: "red", on_leave: "gold",
  terminated: "gray", open: "gold", resolved: "green", overridden: "gray", blocking: "red", warning: "gold", info: "blue",
};

export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{value.replace(/_/g, " ")}</Badge>;
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
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
    <Link to={href} className="link">
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

// The fields a form can do without, under their own heading after the essential ones.
export function OptionalFields({ children, className = "grid grid-cols-2 gap-2 sm:grid-cols-3" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="col-span-full space-y-2 border-t border-line pt-3">
      <p className="label muted m-0 text-xs">Optional</p>
      <div className={className}>{children}</div>
    </div>
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

// Rows per list on a screen.
export const PAGE_SIZE = 5;

export function pageParam(v: string | null) {
  const n = Number(v ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// The current query string with some keys set or removed (null removes).
export function withParams(sp: URLSearchParams, set: Record<string, string | null>) {
  const q = new URLSearchParams(sp);
  for (const [k, v] of Object.entries(set)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  return q.size ? `?${q}` : "?";
}

// Previous / next links for one list; keeps the screen's other query parameters.
// One page of a list the page already holds, for lists built in the browser.
export const pageOf = <T,>(list: T[], page: number, size = PAGE_SIZE) => list.slice((page - 1) * size, page * size);

export function Pager({ param, page, total, size = PAGE_SIZE }: { param: string; page: number; total: number; size?: number }) {
  const [sp] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (p: number) => withParams(sp, { [param]: p > 1 ? String(p) : null });
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="muted num">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link to={href(page - 1)} className={btnLight}>← Previous</Link> : <span className={btnLight} aria-disabled="true">← Previous</span>}
        <span className="label num px-2 text-xs">Page {page} / {pages}</span>
        {page < pages ? <Link to={href(page + 1)} className={btnLight}>Next →</Link> : <span className={btnLight} aria-disabled="true">Next →</span>}
      </div>
    </div>
  );
}

export function NotFound() {
  return <PageTitle sub="This page does not exist, or you cannot see it.">Not found</PageTitle>;
}

// Shows the screen once its data has loaded: not found for a 404, the login page when signed out, the error otherwise.
export function Show<T>({ load, children }: { load: Loaded<T>; children: (data: T) => React.ReactNode }) {
  if (load.error instanceof ApiError && load.error.status === 401) return <Navigate to="/login" replace />;
  if (load.error instanceof ApiError && load.error.status === 404) return <NotFound />;
  if (load.error) return <p className="form-error">{load.error.message}</p>;
  if (load.data === undefined) return <p className="muted text-sm">Loading…</p>;
  return <>{children(load.data)}</>;
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

// The typed search box in a list's header; pair it with useListFilter, which applies it as you type.
export function SearchBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return <input className="input mr-1 w-60 max-w-full" type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />;
}

// Dims a list while its typed filter waits to apply or the next page loads.
export const dimWhile = (busy: boolean) => (busy ? "opacity-60 transition-opacity" : "transition-opacity");
