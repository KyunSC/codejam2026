"use client";

import { useRef, useState } from "react";

/** Makes the homework (once), then copies the student link, or shows it selected if the clipboard is blocked. */
export function ShareButton({ simId, disabled }: { simId: string | null; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = link && link.id === simId ? link : null;

  async function share() {
    if (!simId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sims/${simId}/share`, { method: "POST" });
      const j = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error ?? "Couldn't make the link.");
      const url = new URL(j.url, window.location.origin).toString();
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      setLink({ id: simId, url, copied });
      if (!copied) requestAnimationFrame(() => input.current?.select());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-secondary text-xl"
        data-testid="share-button"
        disabled={disabled || !simId || busy}
        onClick={() => void share()}
      >
        {busy ? "Making homework…" : "Share with students"}
      </button>
      {shown ? (
        <>
          <label htmlFor="share-link" className="sr-only">
            Student link
          </label>
          <input
            id="share-link"
            ref={input}
            data-testid="share-link"
            className="field min-w-0 flex-1 text-lg"
            readOnly
            value={shown.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="text-lg font-semibold text-emerald-800" role="status">
            {shown.copied ? "Link copied" : "Copy this link"}
          </span>
        </>
      ) : null}
      {error ? (
        <span className="text-lg font-semibold text-red-800" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
