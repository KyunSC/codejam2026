"use client";

import { useState } from "react";
import { useSimSession } from "@/lib/useSimSession";
import { ParamSliders } from "./ParamSliders";
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
    <div className="flex h-screen min-h-[640px] gap-5 p-5">
      <section className="flex min-h-0 basis-[70%] flex-col gap-4" aria-label="Simulation">
        <h1 className="text-3xl font-bold leading-tight" data-testid="student-title">
          {title}
        </h1>
        <div className="min-h-0 flex-1">
          <SimPanel
            session={session}
            onRetry={() => session.load(code, { initial })}
            idle={started ? null : "The simulation appears after you write your prediction and press Run."}
          />
        </div>
      </section>

      <aside className="short-stack flex min-h-0 basis-[30%] flex-col gap-5 overflow-y-auto pr-1" aria-label="Homework">
        <p
          className="short-question rounded-xl border-l-8 border-[#2563eb] bg-blue-50 p-4 text-2xl font-semibold leading-snug"
          data-testid="homework-question"
        >
          {question}
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label htmlFor="prediction" className="text-xl font-semibold">
            Predict before you run
          </label>
          <textarea
            id="prediction"
            data-testid="prediction-input"
            className="field min-h-[5em] text-xl"
            placeholder="I think… because…"
            value={prediction}
            readOnly={started}
            onChange={(e) => setPrediction(e.target.value)}
          />
          {started ? null : (
            <button type="submit" className="btn-primary text-2xl" data-testid="run-button" disabled={!prediction.trim()}>
              Run
            </button>
          )}
        </form>
        {v.state === "ready" ? <ParamSliders params={v.params} values={v.values} onChange={session.setValue} /> : null}
      </aside>
    </div>
  );
}
