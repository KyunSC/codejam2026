import type { ReactNode } from "react";

/**
 * The invoice as paper: white with dark text in both themes. Children are the document body;
 * wrap extracted values in <Mark>.
 */
export function DocPreview({ children, caption, label = "Original document" }: { children: ReactNode; caption?: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="min-w-0">
      <div
        className="rounded-md border-2 border-border p-5 text-sm sm:p-9"
        style={{ background: "var(--paper)", color: "var(--paper-text)", boxShadow: "6px 6px 0 var(--shadow)" }}
      >
        {children}
      </div>
      {caption && <p className="muted mx-1 mt-[18px] mb-0 text-[13px]">{caption}</p>}
    </section>
  );
}

/**
 * A value read from the document. `match`: agrees with the vendor record (gold).
 * `flag`: what a flag is about (red). The tone is also given in text for screen readers.
 */
export function Mark({ tone, children }: { tone: "match" | "flag"; children: ReactNode }) {
  return (
    <mark className={tone === "match" ? "mark-match" : "mark-flag"} style={{ color: "inherit" }}>
      {children}
      <span className="sr-only">{tone === "match" ? " (matches vendor record)" : " (flagged)"}</span>
    </mark>
  );
}

/** Muted text inside the document, at paper contrast. */
export function PaperMuted({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--paper-muted)" }}>{children}</span>;
}

/** One line of the document's line-item table. */
export function DocLine({ cells, head }: { cells: [ReactNode, ReactNode, ReactNode]; head?: boolean }) {
  return (
    <div
      className="grid grid-cols-[1fr_56px_96px] gap-2 py-[7px] sm:grid-cols-[1fr_80px_100px]"
      style={{
        borderBottom: head ? "2px solid var(--paper-text)" : "1px solid var(--paper-line)",
        fontWeight: head ? 700 : undefined,
      }}
    >
      <span>{cells[0]}</span>
      <span className="num text-right">{cells[1]}</span>
      <span className="num text-right">{cells[2]}</span>
    </div>
  );
}
