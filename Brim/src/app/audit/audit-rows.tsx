"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

/** One audit row, ready to show. Built on the server so this component only lays it out. */
export interface AuditRowView {
  seq: string;
  when: string;
  who: string;
  whoDetail: string | null;
  onBehalfOf: string | null;
  what: string;
  reason: string | null;
  note: string | null;
  record: { text: string; href: string | null };
  entityId: string;
  changed: string[];
}

/** One action: its main row, then the other rows the same action wrote. */
export interface AuditEntryView {
  head: AuditRowView;
  parts: AuditRowView[];
}

function Cells({ row, part }: { row: AuditRowView; part?: boolean }) {
  return (
    <>
      <td className="num text-sm whitespace-nowrap">
        {part ? <span className="muted">└ {row.when}</span> : row.when}
      </td>
      <td className="text-sm">
        {row.who}
        {row.whoDetail && <div className="muted text-xs">{row.whoDetail}</div>}
        {row.onBehalfOf && <div className="muted text-xs">for {row.onBehalfOf}</div>}
      </td>
      <td className="text-sm">
        {row.what}
        {row.reason && <div className="muted text-xs">“{row.reason}”</div>}
        {row.note && <div className="muted text-xs">Note: “{row.note}”</div>}
      </td>
      <td className="text-sm">
        {row.record.href ? (
          <Link href={row.record.href} className="underline underline-offset-4">
            {row.record.text}
          </Link>
        ) : (
          row.record.text
        )}
        <div className="muted text-xs">{row.entityId}</div>
      </td>
      <td className="text-sm">{row.changed.length ? row.changed.join(", ") : <span className="muted">—</span>}</td>
    </>
  );
}

/** The triangle: points right when closed, down when open. */
function Toggle({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${count} more ${count === 1 ? "change" : "changes"} from this action`}
      title={`${count} more ${count === 1 ? "change" : "changes"} from this action`}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]"
    >
      <svg
        viewBox="0 0 10 10"
        width="14"
        height="14"
        aria-hidden="true"
        className="transition-transform duration-150"
        style={{ transform: open ? "rotate(90deg)" : "none" }}
      >
        <path d="M2 1 L8 5 L2 9 Z" fill="currentColor" />
      </svg>
    </button>
  );
}

function Entry({ entry }: { entry: AuditEntryView }) {
  const [open, setOpen] = useState(false);
  const n = entry.parts.length;
  return (
    <>
      <tr>
        <td className="w-8 pr-0">{n > 0 && <Toggle open={open} count={n} onClick={() => setOpen((o) => !o)} />}</td>
        <Cells row={entry.head} />
      </tr>
      {open &&
        entry.parts.map((p) => (
          <tr key={p.seq} className="bg-[color-mix(in_srgb,currentColor_4%,transparent)]">
            <td className="w-8 pr-0" />
            <Cells row={p} part />
          </tr>
        ))}
    </>
  );
}

export function AuditEntries({ entries }: { entries: AuditEntryView[] }) {
  return (
    <>
      {entries.map((e) => (
        <Fragment key={e.head.seq}>
          <Entry entry={e} />
        </Fragment>
      ))}
    </>
  );
}
