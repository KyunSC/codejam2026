"use client";

import { useRef, useState } from "react";
import { useSimSession, type EditBase, type ReadyInfo } from "@/lib/useSimSession";
import { useStandInStatus } from "@/lib/useStandInStatus";
import { StandInBadge, TimingBadge } from "./Badges";
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
    <div className="flex h-screen min-h-[600px] gap-5 p-5" data-sim-id={simId ?? ""}>
      <div className="flex min-w-0 basis-[70%] flex-col gap-4">
      <form
        className="flex items-stretch gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label htmlFor="prompt" className="sr-only">
          What is the student confused about?
        </label>
        <textarea
          id="prompt"
          data-testid="prompt-input"
          className="field min-h-[3.6em] flex-1 resize-none text-2xl"
          rows={2}
          placeholder="What is the student confused about? e.g. “Does a heavier pendulum swing faster?”"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              create();
            }
          }}
        />
        <button type="submit" className="btn-primary text-2xl" data-testid="create-button" disabled={busy || !prompt.trim()}>
          Create simulation
        </button>
      </form>

      <div className="flex min-h-[2.4em] flex-wrap items-center gap-3">
        <StandInBadge standIn={standIn} />
        <TimingBadge ms={v.state === "ready" ? v.interactiveMs : null} />
        <DemosMenu refreshKey={demosKey} disabled={busy} onPick={loadDemo} />
      </div>

        <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label="Simulation">
          <div className="min-h-0 flex-1">
            <SimPanel
              session={session}
              onRetry={last ? retry : undefined}
              idle="Type what a student is confused about, then press “Create simulation”."
            />
          </div>
          <div className="flex flex-wrap items-stretch gap-3">
            <form
              className="flex min-w-[24rem] flex-1 items-stretch gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                askForChange();
              }}
            >
              <label htmlFor="change" className="sr-only">
                Ask for a change
              </label>
              <input
                id="change"
                data-testid="edit-input"
                className="field flex-1 text-xl"
                placeholder="Ask for a change, e.g. “make bob B twice as heavy”"
                value={change}
                disabled={v.state !== "ready"}
                onChange={(e) => setChange(e.target.value)}
              />
              <button
                type="submit"
                className="btn-secondary text-xl"
                data-testid="edit-button"
                disabled={v.state !== "ready" || !change.trim()}
              >
                Ask for a change
              </button>
            </form>
            <button
              type="button"
              className="btn-secondary text-xl"
              data-testid="save-demo-button"
              disabled={v.state !== "ready" || last?.kind === "demo"}
              onClick={() => void saveAsDemo()}
            >
              Save as demo
            </button>
            {demoNote ? (
              <span className="self-center text-lg font-semibold text-emerald-800" role="status" data-testid="demo-note">
                {demoNote}
              </span>
            ) : null}
            <ShareButton simId={simId} disabled={v.state !== "ready"} />
          </div>
        </section>
      </div>

        <aside className="short-stack flex min-h-0 basis-[30%] flex-col gap-5 overflow-y-auto pr-1" aria-label="Controls">
          {v.state === "ready" ? (
            <>
              <h1 className="short-title text-3xl font-bold leading-tight" data-testid="sim-title">
                {v.title}
              </h1>
              {v.question ? (
                <p className="short-question rounded-xl border-l-8 border-[#2563eb] bg-blue-50 p-4 text-2xl font-semibold leading-snug" data-testid="sim-question">
                  {v.question}
                </p>
              ) : null}
              <ParamSliders params={v.params} values={v.values} onChange={session.setValue} />
            </>
          ) : (
            <h1 className="text-3xl font-bold text-slate-500">Live Sim</h1>
          )}
        </aside>
    </div>
  );
}

type Last =
  | { kind: "generate"; prompt: string }
  | { kind: "edit"; request: string; base: EditBase }
  | { kind: "demo"; prompt: string; code: string };
