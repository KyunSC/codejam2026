import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFileStorageWritable, db, type Db } from "./db";
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
      assertFileStorageWritable();
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
      assertFileStorageWritable();
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
      assertFileStorageWritable();
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
      assertFileStorageWritable();
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

/**
 * Sims in Postgres (table livesim_sims, one JSON record per row, predictions included), for deployments
 * without a lasting disk. Changes to a record happen in one statement or under a row lock, so concurrent
 * students can't overwrite each other's predictions.
 */
export function createPgStore({ pool, ready }: Db): SimStore {
  async function bySharedToken<T>(
    shareToken: string,
    change: (sim: SimRecord) => { result: T; save: boolean },
  ): Promise<T | null> {
    await ready;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; record: SimRecord }>(
        "SELECT id, record FROM livesim_sims WHERE record->>'shareToken' = $1 FOR UPDATE",
        [shareToken],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const sim = rows[0].record;
      const { result, save } = change(sim);
      if (save) await client.query("UPDATE livesim_sims SET record = $2::jsonb WHERE id = $1", [rows[0].id, JSON.stringify(sim)]);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    async saveSim(input) {
      await ready;
      const record: SimRecord = { ...input, id: newId(), shareToken: randomUUID().replace(/-/g, ""), createdAt: new Date().toISOString() };
      await pool.query("INSERT INTO livesim_sims (id, record, created_at) VALUES ($1, $2::jsonb, $3)", [
        record.id,
        JSON.stringify(record),
        record.createdAt,
      ]);
      return record;
    },
    async getSim(id) {
      await ready;
      const { rows } = await pool.query<{ record: SimRecord }>("SELECT record FROM livesim_sims WHERE id = $1", [id]);
      return rows[0]?.record ?? null;
    },
    async getSharedSim(token) {
      await ready;
      const { rows } = await pool.query<{ record: SimRecord }>(
        "SELECT record FROM livesim_sims WHERE record->>'shareToken' = $1",
        [token],
      );
      return rows[0]?.record ?? null;
    },
    async listSims() {
      await ready;
      const { rows } = await pool.query<{ record: SimRecord }>(
        "SELECT record FROM livesim_sims ORDER BY created_at DESC LIMIT 200",
      );
      return rows.map(({ record: { id, title, prompt, createdAt } }) => ({ id, title, prompt, createdAt }));
    },
    async updateSim(id, patch) {
      await ready;
      const { rows } = await pool.query<{ record: SimRecord }>(
        "UPDATE livesim_sims SET record = record || ($2::jsonb - 'id' - 'createdAt') WHERE id = $1 RETURNING record",
        [id, JSON.stringify(patch)],
      );
      return rows[0]?.record ?? null;
    },
    async addPrediction(shareToken, input) {
      const out = await bySharedToken<Prediction | "full">(shareToken, (sim) => {
        const existing = input.submissionId ? sim.predictions?.find((p) => p.id === input.submissionId) : undefined;
        if (existing) {
          const changed = Boolean(input.observed && input.observed !== existing.observed);
          if (changed) existing.observed = input.observed;
          return { result: existing, save: changed };
        }
        if ((sim.predictions?.length ?? 0) >= MAX_PREDICTIONS) return { result: "full", save: false };
        const entry: Prediction = {
          id: input.submissionId ?? newId(),
          name: input.name,
          prediction: input.prediction,
          ...(input.observed ? { observed: input.observed } : {}),
          createdAt: new Date().toISOString(),
        };
        sim.predictions = [...(sim.predictions ?? []), entry];
        return { result: entry, save: true };
      });
      return out;
    },
    async setObserved(shareToken, predictionId, observed) {
      const out = await bySharedToken<Prediction | null>(shareToken, (sim) => {
        const entry = sim.predictions?.find((p) => p.id === predictionId);
        if (!entry) return { result: null, save: false };
        entry.observed = observed;
        return { result: entry, save: true };
      });
      return out ?? null;
    },
  };
}

let defaultStore: SimStore | null = null;

/** The app's sims: Postgres when DATABASE_URL is set, data/sims.json otherwise. */
export function store(): SimStore {
  if (!defaultStore) {
    const database = db();
    // SIMS_FILE lets tests point the routes at a temp file.
    defaultStore = database
      ? createPgStore(database)
      : createStore(process.env.SIMS_FILE || path.join(process.cwd(), "data", "sims.json"));
  }
  return defaultStore;
}
