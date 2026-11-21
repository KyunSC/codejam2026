"use client";

import { useEffect, useState } from "react";
import type { SimParam } from "@/lib/types";

export interface DemoSummary {
  slug: string;
  title: string;
  prompt: string;
  handMade?: boolean;
}

export interface DemoFull extends DemoSummary {
  code: string;
  params: SimParam[];
  question: string;
}

/** "Saved demos": loads a stored sim straight into the panel, with no model call. */
export function DemosMenu({
  refreshKey,
  disabled,
  onPick,
}: {
  refreshKey: number;
  disabled?: boolean;
  onPick: (demo: DemoFull) => void;
}) {
  const [list, setList] = useState<DemoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/demos", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ demos: DemoSummary[] }>)
      .then((j) => live && setList(j.demos))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  async function pick(slug: string) {
    if (!slug) return;
    setError(null);
    try {
      const res = await fetch(`/api/demos/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("That demo couldn't be loaded.");
      onPick((await res.json()) as DemoFull);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That demo couldn't be loaded.");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="demos" className="sr-only">
        Saved demos
      </label>
      <select
        id="demos"
        data-testid="demos-select"
        className="btn-secondary min-h-[2.2rem] cursor-pointer py-1 pl-3 pr-2 font-bold"
        value=""
        disabled={disabled || list.length === 0}
        onChange={(e) => void pick(e.target.value)}
      >
        <option value="">{list.length ? "Saved demos" : "No demos yet"}</option>
        {list.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.title}
            {d.handMade ? " (placeholder)" : ""}
          </option>
        ))}
      </select>
      {error ? (
        <span className="font-semibold text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
