"use client";

import { useEffect, useState } from "react";
import type { Prediction } from "@/lib/types";

const POLL_MS = 3000;

/** Students' predictions (and what they saw after Run) for the shared sim, refreshed every few seconds. */
export function ClassPredictions({ simId }: { simId: string }) {
  const [state, setState] = useState<{ simId: string; list: Prediction[] } | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const r = await fetch(`/api/sims/${simId}/predictions`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { predictions: Prediction[] };
          if (live) setState({ simId, list: j.predictions });
        }
      } catch {
        // Offline for a moment: try again on the next tick.
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [simId]);

  const list = state?.simId === simId ? state.list : [];
  const reflected = list.filter((p) => p.observed).length;

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Class predictions" data-testid="class-predictions">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="kicker !text-ink">Class predictions</h2>
        <span className="font-bold" data-testid="prediction-count" aria-live="polite">
          {list.length} in{list.length ? ` · ${reflected} checked` : ""}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-muted">Waiting for students to open the link…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...list].reverse().map((p) => (
            <li key={p.id} className="border-l-4 border-gold pl-3" data-testid="prediction-item">
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
