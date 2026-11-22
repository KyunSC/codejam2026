"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AuditRow } from "@/lib/auditEvents";

const BATCH = 20;
const when = (s: string) => new Date(s).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

// The audit table: the first 20 rows come with the page; scrolling to the bottom loads the next 20.
export function AuditList({ initial, q }: { initial: AuditRow[]; q: string }) {
  const [rows, setRows] = useState(initial);
  const [done, setDone] = useState(initial.length < BATCH);
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = end.current;
    if (!el || done) return;
    const obs = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || loading) return;
      setLoading(true);
      const last = rows[rows.length - 1]?.event_id;
      const res = await fetch(`/api/audit/events?q=${encodeURIComponent(q)}&before=${last}`);
      const next: AuditRow[] = res.ok ? await res.json() : [];
      setRows((r) => [...r, ...next]);
      setDone(next.length < BATCH);
      setLoading(false);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rows, done, loading, q]);

  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="tbl text-sm">
        <thead>
          <tr>{["#", "When", "Who", "Action", "On", "Links", "Note"].map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.event_id}>
              <td className="muted text-xs">{e.event_id}</td>
              <td className="whitespace-nowrap text-xs">{when(e.occurred_at)}</td>
              <td>{e.actor ?? "system"} <span className="muted text-xs">{e.actor_role?.replace(/_/g, " ")}</span>{e.on_behalf && <div className="muted text-xs">on behalf of {e.on_behalf}</div>}</td>
              <td className="font-mono text-xs">{e.action}</td>
              <td className="font-mono text-xs">{e.entity_type} {e.entity_id}</td>
              <td className="space-x-2 text-xs">
                {e.invoice_id && <Link className="link" href={`/invoices/${e.invoice_id}`}>{e.invoice_id}</Link>}
                {e.payment_id && <Link className="link" href={`/payments/${e.payment_id}`}>{e.payment_id}</Link>}
                {e.vendor_id && <Link className="link" href={`/vendors/${e.vendor_id}`}>{e.vendor_id}</Link>}
              </td>
              <td className="max-w-xs truncate text-xs">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={end} className="muted px-5 py-4 text-sm">
        {rows.length === 0 ? "No events." : done ? `All ${rows.length} events shown.` : loading ? "Loading…" : ""}
      </div>
    </div>
  );
}
