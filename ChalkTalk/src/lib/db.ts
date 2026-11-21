import "server-only";

import { Pool } from "pg";

/**
 * Where boards, sims and saved demos live. With DATABASE_URL set (production on Vercel, where the
 * filesystem is read-only and not shared between function instances) they go to Postgres; without
 * it, to JSON files under data/ (local development and tests).
 */
export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

/** Saving to files only works on a machine with a writable, lasting disk. Vercel has neither. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Saving isn't set up on this deployment: the server needs a DATABASE_URL (Postgres).");
    this.name = "StorageNotConfiguredError";
  }
}

export function assertFileStorageWritable(): void {
  if (process.env.VERCEL) throw new StorageNotConfiguredError();
}

/** A store failure as a JSON error the page can show, instead of a bare 500. */
export function storageErrorResponse(err: unknown): Response {
  if (err instanceof StorageNotConfiguredError) return Response.json({ error: err.message }, { status: 503 });
  console.error("[store]", err);
  return Response.json({ error: "Couldn't reach the database. Try again in a moment." }, { status: 500 });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS livesim_boards (
  id text PRIMARY KEY,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
ALTER TABLE livesim_boards ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE livesim_boards ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE livesim_boards ADD COLUMN IF NOT EXISTS log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE livesim_boards ADD COLUMN IF NOT EXISTS share_token text UNIQUE;
CREATE TABLE IF NOT EXISTS livesim_sims (
  id text PRIMARY KEY,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS livesim_sims_share_token ON livesim_sims ((record->>'shareToken'));
CREATE TABLE IF NOT EXISTS livesim_demos (
  slug text PRIMARY KEY,
  demo jsonb NOT NULL
);`;

export interface Db {
  pool: Pool;
  /** Resolves once the tables exist (created on first use, once per process). */
  ready: Promise<void>;
}

/** A pool for this URL, with its tables made sure of. Small, since each serverless instance has its own. */
export function createDb(url: string): Db {
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  const ready = pool.query(SCHEMA).then(() => undefined);
  // Keep a failed schema step from becoming an unhandled rejection; callers await `ready` and see it.
  ready.catch(() => {});
  return { pool, ready };
}

let shared: Db | null = null;

/** The app's database, or null when DATABASE_URL isn't set. */
export function db(): Db | null {
  const url = databaseUrl();
  if (!url) return null;
  shared ??= createDb(url);
  return shared;
}
