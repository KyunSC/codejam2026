"use client";

import { useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";

/** Makes the homework (once), then copies the student link, or shows it selected if the clipboard is blocked. */
export function ShareButton({
  simId,
  disabled,
  onShared,
}: {
  simId: string | null;
  disabled?: boolean;
  onShared?: (id: string) => void;
}) {
  const linkId = useId();
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
      onShared?.(simId);
      if (!copied) requestAnimationFrame(() => input.current?.select());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-primary btn-gold"
        data-testid="share-button"
        disabled={disabled || !simId || busy}
        onClick={() => void share()}
      >
        {busy ? "Making homework…" : "Share with students"} <span aria-hidden>→</span>
      </button>
      {shown ? (
        <div className="flex basis-full flex-wrap items-center gap-3">
          <label htmlFor={linkId} className="kicker">
            Student link
          </label>
          <input
            id={linkId}
            ref={input}
            data-testid="share-link"
            className="field min-w-0 flex-1 py-1.5"
            readOnly
            value={shown.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="font-bold text-ok" role="status">
            {shown.copied ? "Link copied" : "Copy this link"}
          </span>
          <ShareQr url={shown.url} />
        </div>
      ) : null}
      {error ? (
        <span className="basis-full font-semibold text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/** The student link as a QR code. Click it to show it big, for the projector. */
function ShareQr({ url }: { url: string }) {
  const [src, setSrc] = useState<{ url: string; data: string } | null>(null);
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: "M" })
      .then((data) => live && setSrc({ url, data }))
      .catch((err: unknown) => console.warn("[sim] QR failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [url]);

  if (!src || src.url !== url) return null;
  return (
    <>
      <button
        type="button"
        className="border-2 border-ink bg-white p-1"
        data-testid="share-qr"
        aria-label="Show the QR code big"
        onClick={() => dialog.current?.showModal()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
        <img src={src.data} alt="QR code for the student link" width={72} height={72} />
      </button>
      <dialog
        ref={dialog}
        className="m-auto border-4 border-ink bg-white p-0 backdrop:bg-black/70"
        data-testid="share-qr-dialog"
        aria-labelledby={titleId}
        onClick={(e) => {
          // The content wrapper fills the dialog, so only a backdrop click lands on the dialog itself.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex flex-col items-center gap-3 p-5 text-ink">
          <h2 id={titleId} className="pix text-[2rem] leading-none">
            Scan for the homework
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
          <img
            src={src.data}
            alt="QR code for the student link"
            className="aspect-square w-[min(calc(100dvh-17rem),70vw)] min-w-[160px]"
          />
          <p className="max-w-[min(calc(100dvh-17rem),70vw)] break-all text-center">{url}</p>
          <button
            type="button"
            className="min-h-[2.6rem] border-2 border-ink bg-white px-5 font-bold text-ink"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
