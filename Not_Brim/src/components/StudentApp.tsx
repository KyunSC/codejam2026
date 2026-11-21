"use client";

import { useState } from "react";
import { useSimSession } from "@/lib/useSimSession";
import { Logo } from "./Badges";
import { ParamSliders } from "./ParamSliders";
import { PetPicker } from "./PetPicker";
import { SimPanel } from "./SimPanel";

/** The student link: write a prediction first, then the sim is revealed with the homework's starting values. */
export function StudentApp({
  code,
  title,
  question,
  initial,
}: {
  code: string;
  title: string;
  question: string;
  initial?: Record<string, number>;
}) {
  const session = useSimSession();
  const [prediction, setPrediction] = useState("");
  const [started, setStarted] = useState(false);
  const v = session.view;

  function run() {
    if (!prediction.trim()) return;
    setStarted(true);
    session.load(code, { initial });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
          <Logo />
          <span className="flex-1" />
          <span className="chip bg-[#c6d0da]">Homework</span>
          <PetPicker />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-7 px-5 pb-12 pt-8">
        <section className="short-hide flex flex-wrap items-end gap-x-10 gap-y-4">
          <p className="pix flex-[1_1_520px] text-[clamp(2rem,4.6vw,3.6rem)] leading-[0.95]">Did you predict before you ran it?</p>
          <span
            className="pix text-[clamp(3rem,7vw,5.4rem)] leading-[0.8] text-blue [text-shadow:5px_5px_0_var(--shadow)]"
            aria-live="polite"
          >
            {started ? "Now look." : "Not yet."}
          </span>
        </section>

        <div className="flex flex-wrap items-start gap-7">
          <section className="min-w-0 flex-[999_1_600px]" aria-label="Simulation">
            <div className="aspect-[16/10] max-h-[calc(100vh-7rem)] w-full">
              <SimPanel
                session={session}
                onRetry={() => session.load(code, { initial })}
                idle={started ? null : <Locked />}
              />
            </div>
          </section>

          <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-6" aria-label="Homework">
            <div className="card-gold p-5">
              <h1 className="kicker mb-1 !text-ink" data-testid="student-title">
                {title}
              </h1>
              <p className="text-[1.2rem] font-bold leading-snug" data-testid="homework-question">
                {question}
              </p>
            </div>

            <form
              className="card flex flex-col gap-3 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
            >
              <label htmlFor="prediction" className="font-bold">
                Predict before you run
              </label>
              <textarea
                id="prediction"
                data-testid="prediction-input"
                className="field min-h-[5em] resize-y bg-card-soft shadow-none read-only:text-muted"
                placeholder="I think… because…"
                value={prediction}
                readOnly={started}
                onChange={(e) => setPrediction(e.target.value)}
              />
              {started ? (
                <p className="text-muted">Your prediction is locked in. Now check it.</p>
              ) : (
                <>
                  <button type="submit" className="btn-primary" data-testid="run-button" disabled={!prediction.trim()}>
                    Run <span aria-hidden>▶</span>
                  </button>
                  <p className="text-muted">Run unlocks once you’ve written something.</p>
                </>
              )}
            </form>

            {v.state === "ready" ? <ParamSliders params={v.params} values={v.values} onChange={session.setValue} /> : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

/** The stage before Run: a lock and what to do. */
function Locked() {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="square" aria-hidden>
        <rect x="4" y="11" width="16" height="10" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <p className="text-[1.3rem] font-bold uppercase tracking-[0.06em]">Locked until you predict</p>
      <p className="text-[var(--stage-muted)]">Write what you expect, then press Run.</p>
    </div>
  );
}
