import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prediction, SimRecord } from "./types";

export type NewSim = Omit<SimRecord, "id" | "createdAt" | "predictions" | "shareToken">;
export type SimSummary = Pick<SimRecord, "id" | "title" | "prompt" | "createdAt">;

/** Predictions kept per sim. Past this, new ones are refused so the file can't grow without bound. */
export const MAX_PREDICTIONS = 200;

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
        const record: SimRecord = { ...input, id: newId(), shareToken: randomUUID().replace(/-/g, ""), createdAt: new Date().toISOString() };
        sims.push(record);
        await writeAll(sims);
        return record;
      });
    },
    async getSim(id: string): Promise<SimRecord | null> {
      await queue;
      return (await readAll()).find((s) => s.id === id) ?? null;
    },
    async getSharedSim(token: string): Promise<SimRecord | null> {
      await queue;
      return (await readAll()).find((s) => s.shareToken === token) ?? null;
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
    /** Add a student's prediction to a sim. Null when the sim doesn't exist, "full" past MAX_PREDICTIONS. */
    addPrediction(
      shareToken: string,
      input: { submissionId?: string; name: string; prediction: string; observed?: string },
    ): Promise<Prediction | null | "full"> {
      return locked(async () => {
        const sims = await readAll();
        const sim = sims.find((s) => s.shareToken === shareToken);
        if (!sim) return null;
        const existing = input.submissionId && sim.predictions?.find((p) => p.id === input.submissionId);
        if (existing) {
          if (input.observed && input.observed !== existing.observed) {
            existing.observed = input.observed;
            await writeAll(sims);
          }
          return existing;
        }
        if ((sim.predictions?.length ?? 0) >= MAX_PREDICTIONS) return "full";
        const entry: Prediction = {
          id: input.submissionId ?? newId(),
          name: input.name,
          prediction: input.prediction,
          ...(input.observed ? { observed: input.observed } : {}),
          createdAt: new Date().toISOString(),
        };
        sim.predictions = [...(sim.predictions ?? []), entry];
        await writeAll(sims);
        return entry;
      });
    },
    /** Record what the student saw after Run. Null when the sim or the prediction doesn't exist. */
    setObserved(shareToken: string, predictionId: string, observed: string): Promise<Prediction | null> {
      return locked(async () => {
        const sims = await readAll();
        const entry = sims.find((s) => s.shareToken === shareToken)?.predictions?.find((p) => p.id === predictionId);
        if (!entry) return null;
        entry.observed = observed;
        await writeAll(sims);
        return entry;
      });
    },
  };
}

export type SimStore = ReturnType<typeof createStore>;

let defaultStore: SimStore | null = null;

/** The app's store at data/sims.json. */
export function store(): SimStore {
  // SIMS_FILE lets tests point the routes at a temp file.
  defaultStore ??= createStore(process.env.SIMS_FILE || path.join(process.cwd(), "data", "sims.json"));
  return defaultStore;
}
