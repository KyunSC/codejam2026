// Offline stand-in model. Replays hand-made fixtures from fixtures/sims/ with
// realistic pacing so the whole pipeline can run without an API key.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BoardAction, BoardItem } from "../board";
import type { BoardEvent, BoardTurnInput, Homework, HomeworkInput, SimModel, StreamEvent } from "../types";

export interface StandInTiming {
  thinkMs: number;
  chunks: number;
  writeMs: number;
  /** A whiteboard turn: time "reading" the board, then the gap between actions. */
  boardMs: number;
}

const DEFAULT_TIMING: StandInTiming = { thinkMs: 1500, chunks: 40, writeMs: 3000, boardMs: 900 };

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
    return matchFixture(prompt) ?? "pendulum";
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

  /**
   * A deterministic whiteboard turn. Test hooks: \`[[fixture:NAME]]\` in the message adds that sim;
   * a message starting with "change:" edits the newest running simulation box.
   */
  async *boardTurn(input: BoardTurnInput): AsyncGenerator<BoardEvent> {
    const start = Date.now();
    yield { type: "status", stage: "thinking" };
    await sleep(this.timing.boardMs);
    yield { type: "status", stage: "writing" };
    for (const action of standInActions(input.board.items, input.message, (n) => this.has(n))) {
      const { type, ...args } = action;
      const r = await input.runTool(type, args);
      yield { type: "tool", name: type, ok: !r.isError, text: r.text };
      await sleep(this.timing.boardMs / 3);
    }
    yield {
      type: "done",
      usage: { input_tokens: 1800 + Math.round(JSON.stringify(input.board.items).length / 4), output_tokens: 120 },
      ms: Date.now() - start,
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

/** The fixture a piece of text is about, by keyword, or null. */
export function matchFixture(text: string): string | null {
  for (const [name, re] of KEYWORDS) if (re.test(text)) return name;
  return null;
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

/** What the stand-in does on the board: reply in a note, and add or change a sim when the words call for it. */
export function standInActions(items: BoardItem[], message: string, has: (fixture: string) => boolean): BoardAction[] {
  const actions: BoardAction[] = [];
  const msg = message.trim();
  const student = items.filter((it) => it.author === "student");
  const notes = student.filter((it) => it.kind === "note" && it.text.trim());
  const latestNote = notes.at(-1);
  const anchor = student.at(-1);
  const beside = anchor ? { x: Math.round(anchor.x + anchor.w + 24), y: Math.round(anchor.y) } : {};
  const mySims = items.filter((it) => it.kind === "sim" && it.code);

  const change = /^change\s*:\s*([\s\S]+)$/i.exec(msg);
  if (change && mySims.length) {
    actions.push({ type: "edit_sim", id: mySims.at(-1)!.id, request: change[1].trim() });
    actions.push({ type: "add_note", text: `I'm changing the simulation: ${clip(change[1].trim(), 120)}`, ...beside });
    return actions;
  }

  const forced = /\[\[fixture:([a-z0-9-]+)\]\]/i.exec(msg);
  const topicText = msg || (latestNote?.kind === "note" ? latestNote.text : "");
  const fixture = forced && has(forced[1].toLowerCase()) ? forced[1].toLowerCase() : matchFixture(topicText);
  const already = items.some((it) => it.kind === "sim" && (forced ? it.prompt === topicText : matchFixture(it.prompt) === fixture));
  const addSim = Boolean(fixture) && !already;

  const parts: string[] = [];
  if (latestNote?.kind === "note") parts.push(`I read your note: "${clip(latestNote.text.trim(), 100)}".`);
  else if (msg) parts.push(`You asked: "${clip(msg, 100)}".`);
  if (student.some((it) => it.kind === "ink"))
    parts.push("I can't read handwriting in offline mode; with an API key I read it from a picture of the board.");
  if (addSim) parts.push("I put a simulation on the board to test it. Predict what will happen before you move a slider.");
  else if (parts.length) parts.push("What do you predict, and how could you check it?");
  else parts.push("The board is empty. Write what you're wondering about, then press Ask Claude.");

  actions.push({ type: "add_note", text: parts.join(" "), ...beside });
  if (addSim) actions.push({ type: "add_sim", prompt: topicText });
  return actions;
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
