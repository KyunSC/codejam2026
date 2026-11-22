import { useEffect, useRef, useState } from "react";
import { actionName } from "@/lib/auditActions";
import { useSearchParams } from "react-router-dom";
import { API_PAGE_SIZE } from "@/lib/paging";
import { get } from "../api";

// Three dropdowns; picking one filters the log straight away.
export function AuditFilters({ organizationId, invoices, people, actions }: { organizationId: string; invoices: string[]; people: { user_id: string; full_name: string }[]; actions: string[] }) {
  const [sp, setSp] = useSearchParams();
  const set = (key: string, value: string) => {
    const q = new URLSearchParams(sp);
    q.delete("page");
    if (value) q.set(key, value);
    else q.delete(key);
    setSp(q, { replace: true });
  };
  const select = (key: string, label: string, options: [string, string][]) => (
    <label className="field">
      <span>{label}</span>
      <select className="input w-56" value={sp.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">All</option>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <InvoicePicker organizationId={organizationId} first={invoices} value={sp.get("invoice") ?? ""} onChange={(v) => set("invoice", v)} />
      {select("actor", "Person", people.map((p) => [p.user_id, p.full_name]))}
      {select("action", "Action", actions.map((a) => [a, actionName(a)]))}
    </div>
  );
}

// Invoice dropdown: the 20 most recent invoices, and the next 20 each time the list is scrolled to its end.
function InvoicePicker({ organizationId, first, value, onChange }: { organizationId: string; first: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(first);
  const [done, setDone] = useState(first.length < API_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const more = async () => {
    if (loading || done) return;
    setLoading(true);
    const next = await get<string[]>(`/api/organizations/${organizationId}/audit-events/invoices?offset=${items.length}`).catch(() => []);
    setItems((x) => [...x, ...next]);
    setDone(next.length < API_PAGE_SIZE);
    setLoading(false);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="field relative" ref={box}>
      <span>Invoice (most recent first)</span>
      <button type="button" className="input flex w-56 items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <span>{value || "All"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          className="card absolute top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto p-1 text-sm font-normal"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) more();
          }}
        >
          <li><button type="button" className="w-full rounded px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => pick("")}>All</button></li>
          {items.map((i) => (
            <li key={i}>
              <button type="button" aria-current={i === value} className="w-full rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-surface-2 aria-[current=true]:font-bold" onClick={() => pick(i)}>{i}</button>
            </li>
          ))}
          <li className="muted px-2 py-1.5 text-xs">{loading ? "Loading…" : done ? `${items.length} invoices` : "Scroll for more"}</li>
        </ul>
      )}
    </div>
  );
}
