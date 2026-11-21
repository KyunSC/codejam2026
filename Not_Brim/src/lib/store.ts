import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SimRecord } from "./types";

export type NewSim = Omit<SimRecord, "id" | "createdAt">;
export type SimSummary = Pick<SimRecord, "id" | "title" | "prompt" | "createdAt">;

/** A short url-safe id from crypto.randomUUID (12 hex chars ≈ 48 bits). */
export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/** A JSON-file store. Writes are serialised in-process and atomic on disk (tmp file + rename). */
export function createStore(file: string) {
  let queue: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<SimRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as SimRecord[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async function writeAll(sims: SimRecord[]) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(sims, null, 2));
    await rename(tmp, file);
  }

  /** Run read-modify-write steps one at a time. */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  }

  return {
    saveSim(input: NewSim): Promise<SimRecord> {
      return locked(async () => {
        const sims = await readAll();
        const record: SimRecord = { ...input, id: newId(), createdAt: new Date().toISOString() };
        sims.push(record);
        await writeAll(sims);
        return record;
      });
    },
    async getSim(id: string): Promise<SimRecord | null> {
      await queue;
      return (await readAll()).find((s) => s.id === id) ?? null;
    },
    async listSims(): Promise<SimSummary[]> {
      await queue;
      return (await readAll())
        .map(({ id, title, prompt, createdAt }) => ({ id, title, prompt, createdAt }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    updateSim(id: string, patch: Partial<NewSim>): Promise<SimRecord | null> {
      return locked(async () => {
        const sims = await readAll();
        const i = sims.findIndex((s) => s.id === id);
        if (i < 0) return null;
        sims[i] = { ...sims[i], ...patch, id: sims[i].id, createdAt: sims[i].createdAt };
        await writeAll(sims);
        return sims[i];
      });
    },
  };
}

export type SimStore = ReturnType<typeof createStore>;

let defaultStore: SimStore | null = null;

/** The app's store at data/sims.json. */
export function store(): SimStore {
  defaultStore ??= createStore(path.join(process.cwd(), "data", "sims.json"));
  return defaultStore;
}
