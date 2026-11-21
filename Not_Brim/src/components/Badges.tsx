"use client";

export function StandInBadge({ standIn }: { standIn: boolean | null }) {
  if (!standIn) return null;
  return (
    <span
      className="rounded-full border-2 border-amber-600 bg-amber-100 px-4 py-1 text-lg font-semibold text-amber-900"
      data-testid="stand-in-badge"
      title="No API key: replaying hand-made simulations"
    >
      Offline stand-in
    </span>
  );
}

export function TimingBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  return (
    <span
      className="rounded-full border-2 border-emerald-700 bg-emerald-50 px-4 py-1 text-lg font-semibold text-emerald-900 tabular-nums"
      data-testid="timing-badge"
    >
      Interactive in {(ms / 1000).toFixed(1)}s
    </span>
  );
}
