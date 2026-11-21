/**
 * The stand-in used when there is no API key: returns hand-made answers recorded under
 * `fixtures/extracted/`, looked up by the file's SHA-256.
 *
 * Every fixture must say `"handMade": true`; a file without it is refused, so a real answer
 * cannot be passed off as a fixture or the other way round. A file with no recording gets
 * `no_answer` (it needs the real model).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { datasetDir } from "../../dataset";
import type { Extracted } from "../../types";
import type { ExtractInput, ExtractResult, Extractor } from "./types";

export interface RecordedAnswer {
  handMade: true;
  /** The dataset file it was written from (for people; lookup is by hash). */
  file: string;
  sha256: string;
  /** What the fixture is meant to exercise. */
  purpose?: string;
  extracted: Extracted;
  secondRead?: Extracted | null;
}

export function defaultFixturesDir(): string {
  return path.join(path.dirname(datasetDir()), "fixtures", "extracted");
}

export function loadRecordedAnswers(dir: string = defaultFixturesDir()): Map<string, RecordedAnswer> {
  const out = new Map<string, RecordedAnswer>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const a = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as RecordedAnswer;
    if (a.handMade !== true) throw new Error(`${name}: recorded answers must be marked "handMade": true.`);
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error(`${name}: missing or bad sha256.`);
    if (out.has(a.sha256)) throw new Error(`${name}: a second recording for ${a.file}.`);
    out.set(a.sha256, a);
  }
  return out;
}

export class RecordedExtractor implements Extractor {
  readonly kind = "recorded" as const;
  private readonly answers: Map<string, RecordedAnswer>;

  constructor(answers: Map<string, RecordedAnswer> | string = defaultFixturesDir()) {
    this.answers = typeof answers === "string" ? loadRecordedAnswers(answers) : answers;
  }

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const a = this.answers.get(input.sha256);
    if (!a) {
      return {
        ok: false,
        reason: "no_answer",
        detail: "No API key, and no hand-made answer is recorded for this file. It needs a real extraction.",
      };
    }
    return {
      ok: true,
      extracted: structuredClone(a.extracted),
      secondRead: input.hasTextLayer ? null : structuredClone(a.secondRead ?? null),
      source: "recorded",
      model: "hand-made",
    };
  }
}
