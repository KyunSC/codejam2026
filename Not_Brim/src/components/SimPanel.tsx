"use client";

import type { ReactNode } from "react";
import type { SimSession } from "@/lib/useSimSession";
import { GenerationStatus } from "./GenerationStatus";
import { SimFrame } from "./SimFrame";

/** The sim area on the dark stage: iframe, progress overlay, failure card. `data-state` is what tests wait on. */
export function SimPanel({
  session,
  onRetry,
  idle,
  cover,
  className = "",
}: {
  session: SimSession;
  onRetry?: () => void;
  idle?: ReactNode;
  cover?: ReactNode;
  className?: string;
}) {
  const v = session.view;
  const busy = v.state === "streaming" || v.state === "mounting" || v.state === "repairing";
  return (
    <div
      className={`stage relative h-full min-h-[260px] w-full overflow-hidden ${className}`}
      data-testid="sim-panel"
      data-state={v.state}
      data-applied={v.appliedCount}
    >
      {v.srcdoc && v.state !== "failed" ? (
        <SimFrame key={v.mountKey} srcdoc={v.srcdoc} onMessage={session.onBridge} frameRef={session.frameRef} title={v.title} />
      ) : null}

      {v.state === "ready" ? (
        <span className="chip fade-out-late pointer-events-none absolute left-4 top-4 bg-green">
          <span aria-hidden>●</span> Ready
        </span>
      ) : null}

      {busy ? (
        <div className="stage absolute inset-0 flex items-center justify-center rounded-none border-0 p-8">
          <GenerationStatus state={v.state} stage={v.stage} lineCount={v.lineCount} codeTail={v.codeTail} elapsedMs={v.elapsedMs} />
        </div>
      ) : null}

      {v.state === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center" role="alert">
          <span className="chip bg-red">Didn’t work</span>
          <p className="max-w-2xl text-2xl font-bold" data-testid="failed-message">
            {v.error}
          </p>
          {v.errorDetail ? <p className="max-w-2xl text-[var(--stage-muted)]">Details: {v.errorDetail}</p> : null}
          {onRetry ? (
            <button type="button" className="btn-primary !border-[#e9edf1] !bg-[#e9edf1] !text-[#121314]" onClick={onRetry}>
              Try again <span aria-hidden>→</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {v.state === "idle" && idle ? (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">{idle}</div>
      ) : null}

      {cover && v.state === "ready" ? <div className="absolute inset-0">{cover}</div> : null}
    </div>
  );
}
