"use client";

import { useRef, useState } from "react";
import { useSimSession, type EditBase, type ReadyInfo } from "@/lib/useSimSession";
import { useStandInStatus } from "@/lib/useStandInStatus";
import { Logo, StandInBadge, TimingBadge } from "./Badges";
import { PetPicker } from "./PetPicker";
import { DemosMenu, type DemoFull } from "./DemosMenu";
import { ParamSliders } from "./ParamSliders";
import { ShareButton } from "./ShareButton";
import { SimPanel } from "./SimPanel";

export function TeacherApp() {
  const [simId, setSimId] = useState<string | null>(null);
  const saveSeq = useRef(0);
  const session = useSimSession({ onReady: save });
  const standIn = useStandInStatus();
  const [prompt, setPrompt] = useState("");
  const [change, setChange] = useState("");
  const [last, setLast] = useState<Last | null>(null);
  const [demosKey, setDemosKey] = useState(0);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  // The prompt behind the sim on screen; edits append their request to it.
  const [simPrompt, setSimPrompt] = useState("");

  /** Saved on every ready of a generate or edit, so the share link always points at what's on screen. */
  function save(info: ReadyInfo) {
    if (info.kind === "load" && last?.kind !== "demo") return;
    setDemoNote(null);
    const prompt = last?.kind === "edit" ? `${simPrompt} → ${last.request}` : (last?.prompt ?? simPrompt);
    setSimPrompt(prompt);
    const seq = ++saveSeq.current;
    setSimId(null);
    fetch("/api/sims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, code: info.code, title: info.title, question: info.question, params: info.params }),
    })
      .then(async (r) => {
        const j = (await r.json()) as { id?: string; error?: string };
        if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (seq === saveSeq.current) setSimId(j.id);
      })
      .catch((err: unknown) => console.warn("[sim] save failed:", err instanceof Error ? err.message : err));
  }
  const v = session.view;
  const busy = v.state === "streaming" || v.state === "mounting" || v.state === "repairing";

  function create() {
    const p = prompt.trim();
    if (!p || busy) return;
    setLast({ kind: "generate", prompt: p });
    void session.generate(p);
  }

  function askForChange() {
    const request = change.trim();
    const base = session.snapshot();
    if (!request || !base || busy) return;
    setLast({ kind: "edit", request, base });
    setChange("");
    void session.edit(request, base);
  }

  function retry() {
    if (!last) return;
    if (last.kind === "generate") void session.generate(last.prompt);
    else if (last.kind === "demo") session.load(last.code);
    else void session.edit(last.request, last.base);
  }

  /** A saved demo mounts straight from disk: no /api/generate. It's saved as a sim too, so it can be shared. */
  function loadDemo(demo: DemoFull) {
    if (busy) return;
    setPrompt(demo.prompt);
    setLast({ kind: "demo", prompt: demo.prompt, code: demo.code });
    session.load(demo.code);
  }

  async function saveAsDemo() {
    if (v.state !== "ready" || !v.code) return;
    setDemoNote("Saving…");
    try {
      const res = await fetch("/api/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: simPrompt || prompt, code: v.code, title: v.title, question: v.question, params: v.params }),
      });
      const j = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setDemoNote("Saved as a demo");
      setDemosKey((k) => k + 1);
    } catch (err) {
      setDemoNote(`Couldn't save the demo: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-[600px]" data-sim-id={simId ?? ""}>
      <header className="border-b border-[var(--rule)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5">
          <Logo />
          <span className="flex-1" />
          {demoNote ? (
            <span className="font-bold text-ok" role="status" data-testid="demo-note">
              {demoNote}
            </span>
          ) : null}
          <StandInBadge standIn={standIn} />
          <TimingBadge ms={v.state === "ready" ? v.interactiveMs : null} />
          <button
            type="button"
            className="btn-secondary min-h-[2.2rem] py-1"
            data-testid="save-demo-button"
            disabled={v.state !== "ready" || last?.kind === "demo"}
            onClick={() => void saveAsDemo()}
          >
            Save as demo
          </button>
          <DemosMenu refreshKey={demosKey} disabled={busy} onPick={loadDemo} />
          <PetPicker />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 content-start gap-x-7 gap-y-4 px-4 pb-4 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,30%)] lg:grid-rows-[auto_minmax(0,1fr)] lg:px-6">
        <form
          className="grid min-w-0 gap-y-2 lg:col-span-2 lg:grid-cols-subgrid"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label htmlFor="prompt" className="kicker short-sr lg:col-span-2">
            What is the class confused about?
          </label>
          <textarea
            id="prompt"
            data-testid="prompt-input"
            className="field min-h-[3.2em] resize-none text-[1.1rem]"
            rows={2}
            placeholder="e.g. “They think a heavier pendulum bob swings faster.”"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                create();
              }
            }}
          />
          <button type="submit" className="btn-primary" data-testid="create-button" disabled={busy || !prompt.trim()}>
            Create simulation <span aria-hidden>→</span>
          </button>
        </form>

        <section className="flex min-h-0 flex-col gap-4" aria-label="Simulation">
          <div className="h-[50svh] min-h-[260px] lg:h-auto lg:min-h-0 lg:flex-1">
            <SimPanel
              session={session}
              onRetry={last ? retry : undefined}
              className="shadow-[6px_6px_0_var(--blue)]"
              idle={
                <p className="max-w-xl text-[1.1rem] font-medium text-[var(--stage-muted)]">
                  Type what the class is confused about, then press <strong className="text-[var(--stage-text)]">Create simulation</strong>.
                </p>
              }
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <form
              className="flex min-w-0 basis-full flex-wrap lg:min-w-[20rem] lg:flex-1 items-stretch gap-x-3 gap-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                askForChange();
              }}
            >
              <label htmlFor="change" className="kicker short-sr basis-full">
                Ask for a change
              </label>
              <input
                id="change"
                data-testid="edit-input"
                className="field min-w-0 flex-1"
                placeholder="e.g. “make bob B twice as heavy”"
                value={change}
                disabled={v.state !== "ready"}
                onChange={(e) => setChange(e.target.value)}
              />
              <button
                type="submit"
                className="btn-secondary"
                data-testid="edit-button"
                disabled={v.state !== "ready" || !change.trim()}
              >
                Apply
              </button>
            </form>
            <ShareButton simId={simId} disabled={v.state !== "ready"} />
          </div>
        </section>

        <aside className="short-stack flex min-h-0 flex-col gap-5 overflow-y-auto pb-2 pr-2" aria-label="Controls">
          <div>
            <p className="kicker short-hide mb-1">Now showing</p>
            {v.state === "ready" ? (
              <h1 className="pix short-title text-[2rem] leading-[0.95]" data-testid="sim-title">
                {v.title}
              </h1>
            ) : (
              <h1 className="pix short-title text-[2rem] leading-[0.95] text-muted">Nothing yet</h1>
            )}
          </div>
          {v.state === "ready" && v.question ? (
            <div className="card-gold short-tight p-5">
              <p className="kicker short-hide mb-1 !text-ink">Ask the class</p>
              <p className="short-text text-[1.2rem] font-bold leading-snug" data-testid="sim-question">
                {v.question}
              </p>
            </div>
          ) : null}
          {v.state === "ready" ? <ParamSliders params={v.params} values={v.values} onChange={session.setValue} /> : null}
        </aside>
      </main>
    </div>
  );
}

type Last =
  | { kind: "generate"; prompt: string }
  | { kind: "edit"; request: string; base: EditBase }
  | { kind: "demo"; prompt: string; code: string };
