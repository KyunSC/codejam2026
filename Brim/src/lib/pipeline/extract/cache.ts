/**
 * Per-hash cache of real model answers (PLAN: "raw LLM output is cached per file hash, so
 * re-runs are free and deterministic").
 *
 * One JSON file per SHA-256 under `extraction-cache/`. It is a folder, not a table, so it can
 * be committed and a deployment with no key still has every answer already paid for.
 *
 * Only answers from the real model go in: `put` refuses any entry whose source is not
 * `claude`, so a hand-made recorded answer can never be mistaken for a real one later.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { datasetDir } from "../../dataset";
import type { Extracted } from "../../types";

export interface CacheEntry {
  source: "claude";
  sha256: string;
  model: string;
  /** ISO timestamp of the call. */
  extractedAt: string;
  extracted: Extracted;
  secondRead: Extracted | null;
}

export interface ExtractionCache {
  get(sha256: string): CacheEntry | null;
  put(entry: CacheEntry): void;
}

const SHA = /^[0-9a-f]{64}$/;

export function defaultCacheDir(): string {
  return process.env.EXTRACTION_CACHE_DIR ?? path.join(path.dirname(datasetDir()), "extraction-cache");
}

export class FileExtractionCache implements ExtractionCache {
  constructor(readonly dir: string = defaultCacheDir()) {}

  private file(sha256: string): string {
    if (!SHA.test(sha256)) throw new Error(`Not a SHA-256: ${sha256}`);
    return path.join(this.dir, `${sha256}.json`);
  }

  get(sha256: string): CacheEntry | null {
    const f = this.file(sha256);
    if (!existsSync(f)) return null;
    const entry = JSON.parse(readFileSync(f, "utf8")) as CacheEntry;
    // A file that is not a real answer for this hash is ignored, not trusted.
    if (entry.source !== "claude" || entry.sha256 !== sha256) return null;
    return entry;
  }

  put(entry: CacheEntry): void {
    if ((entry as { source: string }).source !== "claude") {
      throw new Error("Only real model answers go in the extraction cache.");
    }
    const f = this.file(entry.sha256);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
    renameSync(tmp, f);
  }
}

/** For tests and one-off runs. */
export class MemoryExtractionCache implements ExtractionCache {
  readonly entries = new Map<string, CacheEntry>();
  get(sha256: string) {
    return this.entries.get(sha256) ?? null;
  }
  put(entry: CacheEntry) {
    if ((entry as { source: string }).source !== "claude") {
      throw new Error("Only real model answers go in the extraction cache.");
    }
    this.entries.set(entry.sha256, entry);
  }
}
