"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rememberBoard } from "./BoardsHome";

const KEY = "livesim.shared";

/** The copy this browser already made of a shared board, so opening the link again returns to it. */
function copies(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A shared board's link: makes this student's own copy (once per browser) and opens it. */
export function OpenSharedBoard({ token, title }: { token: string; title: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    const existing = copies()[token];
    if (existing) {
      const r = await fetch(`/api/boards/${existing}?since=999999999`, { cache: "no-store" }).catch(() => null);
      if (r && (r.status === 204 || r.ok)) return router.replace(`/b/${existing}`);
    }
    try {
      const res = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share: token }) });
      const j = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !j?.id) throw new Error(j?.error ?? `HTTP ${res.status}`);
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...copies(), [token]: j.id }));
      } catch {
        // Storage blocked: opening the link again makes another copy, which still works.
      }
      rememberBoard(j.id);
      router.replace(`/b/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  useEffect(() => {
    // Once, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once
  }, []);

  return (
    <main className="flex h-screen items-center justify-center bg-paper p-6 text-center">
      {error ? (
        <div className="card flex flex-col items-center gap-3 p-4" role="alert">
          <p className="font-bold text-danger">Couldn&apos;t open {JSON.stringify(title)}: {error}</p>
          <button type="button" className="btn-primary" onClick={() => void open()}>
            Try again
          </button>
        </div>
      ) : (
        <p className="font-medium text-muted" role="status">
          Opening your copy of {JSON.stringify(title)}…
        </p>
      )}
    </main>
  );
}
