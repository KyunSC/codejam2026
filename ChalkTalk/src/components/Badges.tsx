"use client";

export function StandInBadge({ standIn }: { standIn: boolean | null }) {
  if (!standIn) return null;
  return (
    <span className="chip bg-gold" data-testid="stand-in-badge" title="No API key: replaying hand-made simulations">
      Offline stand-in
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
