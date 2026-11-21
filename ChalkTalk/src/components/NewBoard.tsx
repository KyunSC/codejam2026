"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Makes a new board and opens it. */
export function NewBoard() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const res = await fetch("/api/boards", { method: "POST" });
      const j = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !j?.id) throw new Error(j?.error ?? `HTTP ${res.status}`);
      router.replace(`/b/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  useEffect(() => {
    // Once, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once
  }, []);

  return (
    <main className="flex h-screen items-center justify-center bg-paper p-6 text-center">
      {error ? (
        <div className="card flex flex-col items-center gap-3 p-4" role="alert">
          <p className="font-bold text-danger">Couldn&apos;t start a whiteboard: {error}</p>
          <button type="button" className="btn-primary" onClick={() => void create()}>
            Try again
          </button>
        </div>
      ) : (
        <p className="font-medium text-muted" role="status">
          Starting a whiteboard…
        </p>
      )}
    </main>
  );
}
