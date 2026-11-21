"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BoardSummary } from "@/lib/board";
import { Logo, ModelBadge } from "./Badges";
import type { ModelStatus } from "@/lib/types";

const KEY = "livesim.boards";

/** The board ids this browser has opened, newest first. There are no accounts: this list is "your" boards. */
function rememberedBoards(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberBoard(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...rememberedBoards().filter((x) => x !== id)].slice(0, 200)));
  } catch {
    // Private mode or storage blocked: the board still works, it just won't be listed.
  }
}

function forgetBoard(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rememberedBoards().filter((x) => x !== id)));
  } catch {
    // Nothing to forget from.
  }
}

interface DemoBoard {
  slug: string;
  title: string;
  prompt: string;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** "My whiteboards": the boards made or opened in this browser, a new-board button, and the demo boards. */
export function BoardsHome({ status }: { status: ModelStatus }) {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [demos, setDemos] = useState<DemoBoard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const ids = rememberedBoards();
    fetch(`/api/boards?ids=${ids.join(",")}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { boards?: BoardSummary[]; demos?: DemoBoard[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (!live) return;
        setBoards(j.boards ?? []);
        setDemos(j.demos ?? []);
      })
      .catch((err: unknown) => live && (setError(err instanceof Error ? err.message : "Couldn't load your boards."), setBoards([])));
    return () => {
      live = false;
    };
  }, []);

  async function create(body: { demo?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!r.ok || !j?.id) throw new Error(j?.error ?? `HTTP ${r.status}`);
      rememberBoard(j.id);
      router.push(`/b/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a whiteboard.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper px-6 py-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center gap-4">
          <Logo />
          <span className="flex-1" />
          <ModelBadge status={status} />
        </header>

        <section className="flex flex-col gap-4" aria-labelledby="mine">
          <div className="flex items-center gap-4">
            <h1 id="mine" className="pix flex-1 text-[1.6rem]">
              My whiteboards
            </h1>
            <button type="button" className="btn-primary" data-testid="new-board" disabled={busy} onClick={() => void create({})}>
              New whiteboard
            </button>
          </div>
          {error ? (
            <p className="font-bold text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {boards === null ? (
            <p className="text-muted">Loading…</p>
          ) : boards.length === 0 ? (
            <p className="text-muted" data-testid="no-boards">
              No whiteboards yet. Start a new one, or open a demo below.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="my-boards">
              {boards.map((b) => (
                <li key={b.id} className="card flex flex-col gap-1 p-4">
                  <a href={`/b/${b.id}`} className="font-bold underline-offset-4 hover:underline" data-testid="board-card">
                    {b.title}
                  </a>
                  <span className="text-muted">
                    {b.itemCount} item{b.itemCount === 1 ? "" : "s"} · {ago(b.updatedAt)}
                  </span>
                  <button
                    type="button"
                    className="self-start text-muted underline-offset-4 hover:underline"
                    onClick={() => {
                      forgetBoard(b.id);
                      setBoards((list) => (list ?? []).filter((x) => x.id !== b.id));
                    }}
                  >
                    Remove from list
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="demos">
          <h2 id="demos" className="pix text-[1.3rem]">
            Demo whiteboards
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="demo-boards">
            {demos.map((d) => (
              <li key={d.slug} className="card flex flex-col gap-2 p-4">
                <span className="font-bold">{d.title}</span>
                <span className="text-muted">{d.prompt}</span>
                <button
                  type="button"
                  className="btn-secondary self-start"
                  data-testid={`open-demo-${d.slug}`}
                  disabled={busy}
                  onClick={() => void create({ demo: d.slug })}
                >
                  Open a copy
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
