"use client";

import { useState } from "react";
import { useSimSession } from "@/lib/useSimSession";
import { useStandInStatus } from "@/lib/useStandInStatus";
import { StandInBadge, TimingBadge } from "./Badges";
import { ParamSliders } from "./ParamSliders";
import { SimPanel } from "./SimPanel";

export function TeacherApp() {
  const session = useSimSession();
  const standIn = useStandInStatus();
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const v = session.view;
  const busy = v.state === "streaming" || v.state === "mounting" || v.state === "repairing";

  function create() {
    const p = prompt.trim();
    if (!p || busy) return;
    setLastPrompt(p);
    void session.generate(p);
  }

  return (
    <div className="flex h-screen min-h-[640px] flex-col gap-4 p-5">
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
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        <section className="flex min-h-0 basis-[70%] flex-col gap-4" aria-label="Simulation">
          <div className="min-h-0 flex-1">
            <SimPanel
              session={session}
              onRetry={lastPrompt ? () => void session.generate(lastPrompt) : undefined}
              idle="Type what a student is confused about, then press “Create simulation”."
            />
          </div>
        </section>

        <aside className="flex min-h-0 basis-[30%] flex-col gap-5 overflow-y-auto pr-1" aria-label="Controls">
          {v.state === "ready" ? (
            <>
              <h1 className="text-3xl font-bold leading-tight" data-testid="sim-title">
                {v.title}
              </h1>
              {v.question ? (
                <p className="rounded-xl border-l-8 border-[#2563eb] bg-blue-50 p-4 text-2xl font-semibold leading-snug" data-testid="sim-question">
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
    </div>
  );
}
