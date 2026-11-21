"use client";

import type { ModelStatus } from "@/lib/types";

/** Which model answers: the offline stand-in (and why), or the provider and model from .env.local. */
export function ModelBadge({ status, compact = false }: { status: ModelStatus; compact?: boolean }) {
  if (status.standIn) {
    return (
      <span
        className="chip shrink-0 bg-gold"
        data-testid="stand-in-badge"
        title={`Offline stand-in: ${status.reason ?? "no API key."} Replies and simulations are hand-made replays.`}
      >
        {compact ? "Offline" : "Offline stand-in"}
      </span>
    );
  }
  return (
    <span className="chip shrink-0 bg-[#c6d0da]" data-testid="model-badge" title={`${status.provider} · ${status.model ?? ""}`}>
      {status.assistant === "AI" ? status.provider : status.assistant}
      {status.model && !compact ? <span className="ml-1 font-normal opacity-70">{status.model}</span> : null}
    </span>
  );
}

export function TimingBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  return (
    <span className="chip bg-[#c6d0da] tabular-nums" data-testid="timing-badge">
      Interactive in {(ms / 1000).toFixed(1)}s
    </span>
  );
}

/** Logo: "Live" in ink, "Sim" in blue, pixel type. */
export function Logo() {
  return (
    <span className="pix text-[1.2rem] leading-none" aria-label="Live Sim">
      Live<span className="text-blue">Sim</span>
    </span>
  );
}
