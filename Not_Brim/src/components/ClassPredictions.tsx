"use client";

import { useEffect, useId, useState } from "react";
import type { PublicPrediction } from "@/lib/types";

const POLL_MS = 3000;
/** Failed polls in a row before the panel says it can't reach the server. */
const FAILS_BEFORE_NOTE = 3;

export interface SharedSim {
  id: string;
  title: string;
}

/** Live predictions for a shared sim, polled every few seconds while the tab is visible. */
export function usePredictions(simId: string | null) {
  const [state, setState] = useState<{ simId: string; list: PublicPrediction[]; failing: boolean } | null>(null);

  useEffect(() => {
    if (!simId) return;
    let live = true;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      // A hidden tab (another app on the projector) doesn't need fresh answers.
      if (document.visibilityState !== "hidden") {
        try {
          const r = await fetch(`/api/sims/${simId}/predictions`, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as { predictions: PublicPrediction[] };
          fails = 0;
          if (live) setState({ simId: simId!, list: j.predictions, failing: false });
        } catch {
          fails += 1;
          if (live && fails >= FAILS_BEFORE_NOTE)
            setState((s) => ({ simId: simId!, list: s?.simId === simId ? s.list : [], failing: true }));
        }
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [simId]);

  const current = state && state.simId === simId ? state : null;
  return { list: current?.list ?? [], failing: current?.failing ?? false };
}

export function countLabel(list: PublicPrediction[]): string {
  const reflected = list.filter((p) => p.observed).length;
  const n = list.length;
  return `${n} prediction${n === 1 ? "" : "s"}${n ? ` · ${reflected} reflection${reflected === 1 ? "" : "s"}` : ""}`;
}

/** Students' predictions, and what they saw after Run, for the sim whose link went out. */
export function ClassPredictions({
  shared,
  current,
  list,
  failing,
}: {
  shared: SharedSim;
  /** The sim on screen now, to warn when the panel belongs to an earlier one. */
  current: string | null;
  list: PublicPrediction[];
  failing: boolean;
}) {
  const titleId = useId();
  return (
    <section
      className="card flex scroll-mt-4 flex-col gap-3 p-5"
      aria-labelledby={titleId}
      data-testid="class-predictions"
    >
      <div>
        <h2 id={titleId} className="kicker !text-ink">
          Class predictions
        </h2>
        <p className="font-bold" data-testid="predictions-for">
          For “{shared.title}”
        </p>
        {current && current !== shared.id ? (
          <p className="text-muted" data-testid="predictions-earlier">
            This is the sim you shared earlier. Share again to collect answers for the one on screen.
          </p>
        ) : null}
      </div>
      <p className="font-bold" data-testid="prediction-count">
        {countLabel(list)}
      </p>
      {failing ? (
        <p className="font-semibold text-danger" role="alert">
          Can’t reach the server. Retrying…
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="text-muted">No predictions yet. They show up here when students press Run.</p>
      ) : (
        <ul className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-1" tabIndex={0} aria-label="Predictions, newest first">
          {list
            .map((p, i) => ({ p, key: `${p.createdAt}-${i}` }))
            .reverse()
            .map(({ p, key }) => (
              <li key={key} className="border-l-4 border-gold pl-3" data-testid="prediction-item">
                <p className="font-bold">{p.name}</p>
                <p>
                  <span className="text-muted">Predicted: </span>
                  {p.prediction}
                </p>
                {p.observed ? (
                  <p>
                    <span className="text-muted">Saw: </span>
                    {p.observed}
                  </p>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
