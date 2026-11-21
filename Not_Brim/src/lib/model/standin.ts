// Offline stand-in model. Replays hand-made fixtures from fixtures/sims/ with
// realistic pacing so the whole pipeline can run without an API key.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Homework, HomeworkInput, SimModel, StreamEvent } from "../types";

export interface StandInTiming {
  thinkMs: number;
  chunks: number;
  writeMs: number;
}

const DEFAULT_TIMING: StandInTiming = { thinkMs: 1500, chunks: 40, writeMs: 3000 };

const KEYWORDS: Array<[string, RegExp]> = [
  ["pendulum", /pendul|swing|\bbob\b|period/i],
  ["falling", /fall|drop|air resist|feather|heav(y|ier) .*(land|ground)|terminal/i],
  ["throws", /ramp|incline|slope|slid(e|ing)|friction/i],
];

const MARKER = /<!--\s*hand-made fixture:\s*([a-z0-9-]+)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class StandInModel implements SimModel {
  private dir: string;
  private timing: StandInTiming;

  constructor(opts: { dir?: string; timing?: Partial<StandInTiming> } = {}) {
    this.dir = opts.dir ?? path.join(process.cwd(), "fixtures", "sims");
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
  }

  has(name: string): boolean {
    return /^[a-z0-9-]+$/.test(name) && existsSync(path.join(this.dir, `${name}.html`));
  }

  load(name: string): string {
    if (!this.has(name)) throw new Error(`No fixture named "${name}"`);
    return readFileSync(path.join(this.dir, `${name}.html`), "utf8");
  }

  /** Which fixture a prompt maps to. `[[fixture:NAME]]` wins, then keywords, then pendulum. */
  pick(prompt: string): string {
    const forced = /\[\[fixture:([a-z0-9-]+)\]\]/i.exec(prompt);
    if (forced && this.has(forced[1].toLowerCase())) return forced[1].toLowerCase();
    for (const [name, re] of KEYWORDS) if (re.test(prompt)) return name;
    return "pendulum";
  }

  /** The fixture name stamped in a document's header comment, if any. */
  static nameOf(code: string): string | null {
    const m = MARKER.exec(code);
    return m ? m[1].toLowerCase() : null;
  }

  generate(prompt: string): AsyncIterable<StreamEvent> {
    return this.replay(this.load(this.pick(prompt)), prompt.length);
  }

  repair(code: string, error: string): AsyncIterable<StreamEvent> {
    const name = StandInModel.nameOf(code);
    let fixed = code;
    if (name === "throws-twice" || name === "throws-twice-2") fixed = this.load("throws-twice-2");
    else if (name?.endsWith("-broken") && this.has(name.slice(0, -"-broken".length)))
      fixed = this.load(name.slice(0, -"-broken".length));
    return this.replay(fixed, code.length + error.length);
  }

  edit(code: string, request: string): AsyncIterable<StreamEvent> {
    const name = StandInModel.nameOf(code);
    const edited =
      name && this.has(`${name}-edited`) ? this.load(`${name}-edited`) : bumpFirstDefault(code);
    return this.replay(edited, code.length + request.length);
  }

  async homework(input: HomeworkInput): Promise<Homework> {
    const title = input.title?.trim() || "this simulation";
    const defaults: Record<string, number> = {};
    for (const p of input.params) defaults[p.id] = oneStep(p.value, p.min, p.max, p.step);
    return {
      question: `Homework for "${title}": the sliders start somewhere new. Before you press Run, predict what you will see this time, and how it differs from what the class saw.`,
      defaults,
    };
  }

  private async *replay(text: string, inputChars: number): AsyncGenerator<StreamEvent> {
    const start = Date.now();
    const { thinkMs, chunks, writeMs } = this.timing;
    yield { type: "status", stage: "thinking" };
    await sleep(thinkMs);
    yield { type: "status", stage: "writing" };
    const size = Math.ceil(text.length / chunks);
    for (let i = 0; i < text.length; i += size) {
      yield { type: "delta", text: text.slice(i, i + size) };
      await sleep(writeMs / chunks);
    }
    yield {
      type: "done",
      stopReason: "end_turn",
      usage: {
        input_tokens: Math.round(inputChars / 4) + 2600,
        output_tokens: Math.round(text.length / 4),
      },
      ms: Date.now() - start,
    };
  }
}

/** Move a value one step up (or down at the top), staying on the step grid and in range. */
export function oneStep(value: number, min: number, max: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const round = (n: number) => Number(n.toFixed(decimals));
  const up = round(value + step);
  if (up <= max) return up;
  const down = round(value - step);
  return down >= min ? down : value;
}

/**
 * Change the first param's default value in a SIM document, keeping it valid.
 * Expects the param written as `{id:...,min:N,max:N,step:N,value:N}` in that order.
 */
export function bumpFirstDefault(code: string): string {
  const start = code.indexOf("params:");
  if (start < 0) return code;
  const re = /min:\s*(-?[\d.]+)\s*,\s*max:\s*(-?[\d.]+)\s*,\s*step:\s*([\d.]+)\s*,\s*value:\s*(-?[\d.]+)/;
  const rest = code.slice(start);
  const m = re.exec(rest);
  if (!m) return code;
  const [min, max, step, value] = m.slice(1).map(Number);
  const next = oneStep(value, min, max, step);
  const replaced = m[0].replace(/value:\s*(-?[\d.]+)$/, `value:${next}`);
  return code.slice(0, start) + rest.slice(0, m.index) + replaced + rest.slice(m.index + m[0].length);
}
