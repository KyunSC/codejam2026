"use client";

import type { SessionState, Stage } from "@/lib/types";

const LABELS: Record<string, string> = {
  thinking: "Thinking about the physics…",
  writing: "Writing the simulation…",
  mounting: "Starting the simulation…",
  repairing: "Fixing a glitch…",
  connecting: "Connecting…",
};

export function GenerationStatus({
  state,
  stage,
  lineCount,
  codeTail,
  elapsedMs,
}: {
  state: SessionState;
  stage: Stage | null;
  lineCount: number;
  codeTail: string;
  elapsedMs: number;
}) {
  const key = state === "repairing" || state === "mounting" ? state : (stage ?? "connecting");
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4" data-testid="generation-status" aria-live="polite">
      <div className="flex items-center gap-4">
        <span className="spinner" aria-hidden />
        <span className="text-2xl font-semibold" data-testid="status-label">
          {LABELS[key]}
        </span>
      </div>
      <div className="flex gap-6 text-xl tabular-nums text-slate-700">
        <span data-testid="status-lines">{lineCount} lines</span>
        <span data-testid="status-seconds">{(elapsedMs / 1000).toFixed(1)} s</span>
      </div>
      {codeTail ? (
        <pre className="max-h-[14em] overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-4 font-mono text-base leading-snug text-slate-100">
          {codeTail}
        </pre>
      ) : null}
    </div>
  );
}
