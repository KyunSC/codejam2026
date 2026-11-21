"use client";

import type { ReactNode } from "react";
import type { SimSession } from "@/lib/useSimSession";
import { GenerationStatus } from "./GenerationStatus";
import { SimFrame } from "./SimFrame";

/** The sim area: iframe, progress overlay, failure card. `data-state` is what tests wait on. */
export function SimPanel({
  session,
  onRetry,
  idle,
  cover,
}: {
  session: SimSession;
  onRetry?: () => void;
  idle?: ReactNode;
  cover?: ReactNode;
}) {
  const v = session.view;
  const busy = v.state === "streaming" || v.state === "mounting" || v.state === "repairing";
  return (
    <div
      className="relative h-full min-h-[260px] w-full overflow-hidden rounded-2xl border-2 border-slate-300 bg-[#f8fafc]"
      data-testid="sim-panel"
      data-state={v.state}
      data-applied={v.appliedCount}
    >
      {v.srcdoc && v.state !== "failed" ? (
        <SimFrame key={v.mountKey} srcdoc={v.srcdoc} onMessage={session.onBridge} frameRef={session.frameRef} title={v.title} />
      ) : null}

      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f8fafc] p-8">
          <GenerationStatus state={v.state} stage={v.stage} lineCount={v.lineCount} codeTail={v.codeTail} elapsedMs={v.elapsedMs} />
        </div>
      ) : null}

      {v.state === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center" role="alert">
          <p className="max-w-2xl text-2xl font-semibold" data-testid="failed-message">
            {v.error}
          </p>
          {v.errorDetail ? <p className="max-w-2xl text-lg text-slate-600">Details: {v.errorDetail}</p> : null}
          {onRetry ? (
            <button type="button" className="btn-primary" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {v.state === "idle" && idle ? (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-2xl text-slate-600">{idle}</div>
      ) : null}

      {cover && v.state === "ready" ? <div className="absolute inset-0">{cover}</div> : null}
    </div>
  );
}
