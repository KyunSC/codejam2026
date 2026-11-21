"use client";

import { useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMascotName } from "@/lib/useMascot";
import { ToolIcon } from "./ToolIcon";

/**
 * The toolbox bar's Share: makes the board's student link (once), copies it, and shows it with a QR code.
 * Each student who opens the link gets their own copy of the whole board.
 */
export function BoardShareButton({ boardId }: { boardId: string }) {
  const mascot = useMascotName();
  const linkId = useId();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      requestAnimationFrame(() => input.current?.select());
      return false;
    }
  }

  async function share() {
    setBusy(true);
    setError(null);
    dialog.current?.showModal();
    try {
      const res = await fetch(`/api/boards/${boardId}/share`, { method: "POST" });
      const j = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error ?? "Couldn't make the link.");
      const url = new URL(j.url, window.location.origin).toString();
      setLink({ url, copied: await copy(url) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="tool-btn" data-testid="share-button" title="Share with students" onClick={() => void share()}>
        <ToolIcon name="share" />
        <span className="tool-label">Share</span>
      </button>
      <dialog
        ref={dialog}
        className="card m-auto w-[min(36rem,calc(100vw-2rem))] p-0 text-text backdrop:bg-black/40"
        data-testid="share-dialog"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="kicker">
            Share this whiteboard
          </h2>
          <p>Each student who opens the link gets their own copy of the board, simulations included, to work on with {mascot}.</p>
          {busy ? <p className="text-muted">Making the link…</p> : null}
          {error ? (
            <p className="font-semibold text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {link ? (
            <>
              <label htmlFor={linkId} className="kicker">
                Student link
              </label>
              <div className="flex gap-2">
                <input
                  id={linkId}
                  ref={input}
                  data-testid="share-link"
                  className="field min-w-0 flex-1 py-1.5"
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => setLink({ url: link.url, copied: await copy(link.url) })}
                >
                  Copy
                </button>
              </div>
              <span className="font-bold text-ok" role="status">
                {link.copied ? "Link copied" : "Copy this link"}
              </span>
              <ShareQr url={link.url} />
            </>
          ) : null}
          <button type="button" className="btn-primary self-end" onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}

/** The student link as a QR code, big enough to scan from a projector. */
function ShareQr({ url }: { url: string }) {
  const [src, setSrc] = useState<{ url: string; data: string } | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: "M" })
      .then((data) => live && setSrc({ url, data }))
      .catch((err: unknown) => console.warn("[board] QR failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [url]);

  if (!src || src.url !== url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise
    <img src={src.data} alt="QR code for the student link" data-testid="share-qr" className="mx-auto aspect-square w-[min(18rem,60vw)] border-2 border-ink bg-white p-1" />
  );
}
