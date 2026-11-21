"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MAX_REQUEST_CHARS, promptAfterEdit, type SimItem } from "@/lib/board";
import { useSimSession, type EditBase, type ReadyInfo } from "@/lib/useSimSession";
import { ParamSliders } from "../ParamSliders";
import { ShareButton } from "../ShareButton";
import { SimPanel } from "../SimPanel";

type Last = { kind: "generate" } | { kind: "load" } | { kind: "edit"; request: string; base: EditBase };

/**
 * A simulation box on the board. It runs its own session: it generates from the prompt when it
 * has no code yet, loads its code otherwise, and runs any change asked for (by the student or Claude).
 */
export function SimBox({
  item,
  selected,
  onPatch,
  onDragStart,
  onResizeStart,
  onDelete,
}: {
  item: SimItem;
  selected: boolean;
  onPatch: (patch: Partial<SimItem>) => void;
  onDragStart: (e: ReactPointerEvent) => void;
  onResizeStart: (e: ReactPointerEvent) => void;
  onDelete: () => void;
}) {
  const session = useSimSession({ onReady: ready });
  const v = session.view;
  const [change, setChange] = useState("");
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const last = useRef<Last | null>(null);
  const handledNonce = useRef<number | null>(null);
  /** Counts sim saves, so only the latest version's id lands on the box. */
  const saveSeq = useRef(0);
  const patch = useRef(onPatch);
  useEffect(() => {
    patch.current = onPatch;
  });

  function ready(info: ReadyInfo) {
    // A box loaded from the board already holds this version, and its sim once that was saved.
    if (info.kind === "load" && item.simId) return;
    const l = last.current;
    const prompt = info.kind === "edit" && l?.kind === "edit" ? promptAfterEdit(item.prompt, l.request) : item.prompt;
    // The old sim id points at the previous version, so it goes until this version is saved.
    // `change` stays: its nonce is what a later request counts up from.
    if (info.kind !== "load")
      patch.current({ code: info.code, title: info.title, question: info.question, params: info.params, prompt, simId: undefined });
    // Each new version is saved as a sim, for the homework link.
    const seq = ++saveSeq.current;
    fetch("/api/sims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, code: info.code, title: info.title, question: info.question, params: info.params }),
    })
      .then(async (r) => {
        const j = (await r.json()) as { id?: string; error?: string };
        if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
        // A later version may have been saved first; its id wins.
        if (seq === saveSeq.current) patch.current({ simId: j.id });
      })
      .catch((err: unknown) => console.warn("[board] sim save failed:", err instanceof Error ? err.message : err));
  }

  // First mount: load the saved code, or generate from the prompt. The stored change counts as handled,
  // so one that was pending (or failed) before a reload doesn't run again.
  useEffect(() => {
    handledNonce.current = item.change?.nonce ?? null;
    if (item.code) {
      last.current = { kind: "load" };
      session.load(item.code, { initial: item.values });
    } else {
      last.current = { kind: "generate" };
      void session.generate(item.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per box
  }, []);

  // A new change request (from Claude's edit_sim or the box's own input) runs once the sim is ready,
  // including one that arrived while the box was busy or had failed.
  const pending = item.change;
  useEffect(() => {
    if (!pending || pending.nonce === handledNonce.current || v.state !== "ready") return;
    handledNonce.current = pending.nonce;
    const base = session.snapshot();
    if (!base) return;
    last.current = { kind: "edit", request: pending.request, base };
    void session.edit(pending.request, base);
  }, [pending, v.state, session]);

  // Keep the box's slider values on the board, so Claude reads them and a reload restores them.
  const values = v.values;
  useEffect(() => {
    if (v.state !== "ready") return;
    const same =
      Object.keys(values).length === Object.keys(item.values).length &&
      Object.entries(values).every(([k, n]) => item.values[k] === n);
    if (!same) patch.current({ values });
  }, [v.state, values, item.values]);

  async function saveAsDemo() {
    if (v.state !== "ready" || !v.code) return;
    setDemoNote("Saving…");
    try {
      const res = await fetch("/api/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: item.prompt, code: v.code, title: v.title, question: v.question, params: v.params }),
      });
      const j = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setDemoNote("Saved as a demo");
    } catch (err) {
      setDemoNote(`Couldn't save the demo: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  function retry() {
    const l = last.current;
    if (!l) return;
    if (l.kind === "edit") void session.edit(l.request, l.base);
    else if (l.kind === "load" && item.code) session.load(item.code, { initial: item.values });
    else void session.generate(item.prompt);
  }

  function askForChange() {
    const request = change.trim();
    if (!request || v.state !== "ready") return;
    setChange("");
    onPatch({ change: { request, nonce: (item.change?.nonce ?? handledNonce.current ?? 0) + 1 } });
  }

  const author = item.author === "claude" ? "Claude" : "You";
  return (
    <div
      className={`board-item card @container flex h-full flex-col overflow-hidden ${
        selected ? "!shadow-[6px_6px_0_var(--gold)]" : item.author === "claude" ? "!shadow-[6px_6px_0_var(--blue)]" : ""
      }`}
      data-testid="sim-box"
      data-item-id={item.id}
      data-author={item.author}
      data-sim-id={item.simId ?? ""}
    >
      <div
        className="flex cursor-grab items-center gap-3 border-b-2 border-[var(--border)] bg-card-soft px-3 py-1.5 active:cursor-grabbing"
        onPointerDown={onDragStart}
        data-testid="item-handle"
      >
        <span className={`chip ${item.author === "claude" ? "bg-blue" : "bg-[#c6d0da]"}`}>{author}</span>
        <h2 className="pix min-w-0 flex-1 truncate text-[1.1rem]" data-testid="sim-title">
          {v.state === "ready" ? v.title : item.title || item.prompt}
        </h2>
        <button type="button" className="item-x" aria-label="Delete simulation" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete}>
          ×
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 @[600px]:flex-row">
        <div className="min-h-[240px] min-w-0 flex-1">
          <SimPanel session={session} onRetry={retry} />
        </div>
        {v.state === "ready" ? (
          <div className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto pr-1 @[600px]:max-h-none @[600px]:w-[13rem]" data-scrolls="1">
            {v.question ? (
              <p className="card-gold p-2 font-bold leading-snug !shadow-none" data-testid="sim-question">
                {v.question}
              </p>
            ) : null}
            <ParamSliders params={v.params} values={v.values} onChange={session.setValue} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-[var(--border)] p-2">
        <form
          className="flex min-w-0 basis-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            askForChange();
          }}
        >
          <input
            className="field min-w-0 flex-1"
            aria-label="Ask for a change"
            data-testid="edit-input"
            placeholder="Ask for a change…"
            value={change}
            maxLength={MAX_REQUEST_CHARS}
            disabled={v.state !== "ready"}
            onChange={(e) => setChange(e.target.value)}
          />
          <button type="submit" className="btn-secondary" data-testid="edit-button" disabled={v.state !== "ready" || !change.trim()}>
            Change
          </button>
        </form>
        <button
          type="button"
          className="btn-secondary"
          data-testid="save-demo-button"
          disabled={v.state !== "ready" || demoNote === "Saved as a demo"}
          onClick={() => void saveAsDemo()}
        >
          Save as demo
        </button>
        {demoNote ? (
          <span className="font-bold text-ok" role="status" data-testid="demo-note">
            {demoNote}
          </span>
        ) : null}
        <ShareButton simId={item.simId ?? null} disabled={v.state !== "ready"} />
      </div>
      <div className="resize-handle" onPointerDown={onResizeStart} aria-hidden />
    </div>
  );
}
