// The whiteboard: items, the checks on them, and the actions Claude takes. Pure and client-safe.
import { validateParams } from "./bridge";
import { validateHtml } from "./sim-html";
import type { SimParam } from "./types";

export type Author = "student" | "claude";

interface ItemBase {
  id: string;
  author: Author;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteItem extends ItemBase {
  kind: "note";
  text: string;
}

export interface Stroke {
  /** Flat [x0, y0, x1, y1, …] in board coordinates. */
  points: number[];
  color: string;
  width: number;
}

export interface InkItem extends ItemBase {
  kind: "ink";
  strokes: Stroke[];
}

/** A box running a simulation. `code` is null until the first generation reaches ready. */
export interface SimItem extends ItemBase {
  kind: "sim";
  prompt: string;
  code: string | null;
  title: string;
  question: string;
  params: SimParam[];
  values: Record<string, number>;
  /**
   * The latest change asked for. It is kept after it runs, so `nonce` only ever rises: a box runs a
   * change whose nonce it hasn't handled, and on load treats the stored one as handled.
   */
  change?: { request: string; nonce: number };
  /** The saved sim behind the box, for the student homework link. */
  simId?: string;
}

export type BoardItem = NoteItem | InkItem | SimItem;

export interface Board {
  id: string;
  items: BoardItem[];
  createdAt: string;
  updatedAt: string;
}

/** What part of the board the student is looking at, in board coordinates. */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NOTE_SIZE = { w: 320, h: 200 };
export const SIM_SIZE = { w: 780, h: 580 };
/** Simulation boxes fill a narrow view (a phone) instead of being zoomed out to fit it. */
export function simSizeFor(view: View | null): { w: number; h: number } {
  if (!view || view.w >= SIM_SIZE.w + 48) return SIM_SIZE;
  return { w: Math.max(340, Math.round(view.w - 32)), h: 760 };
}

export const MAX_ITEMS = 400;
export const MAX_NOTE_CHARS = 4000;
export const MAX_STROKES = 400;
export const MAX_POINTS = 4000;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_REQUEST_CHARS = 2000;
const MAX_COORD = 100_000;
/** How far from the origin the browser lets items and the camera go, well inside MAX_COORD. */
export const MAX_POS = MAX_COORD / 2;
const MIN_SIZE = 40;

export function newItemId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- checks for boards sent by the browser ----------

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const coord = (n: unknown) => finite(n) && Math.abs(n) <= MAX_COORD;
const size = (n: unknown) => finite(n) && n >= MIN_SIZE && n <= MAX_COORD;

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

export function checkItem(raw: unknown): Checked<BoardItem> {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "an item is not an object" };
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || !/^[a-z0-9]{1,24}$/.test(d.id)) return { ok: false, reason: "an item has a bad id" };
  if (d.author !== "student" && d.author !== "claude") return { ok: false, reason: `item ${d.id} has a bad author` };
  if (!coord(d.x) || !coord(d.y) || !size(d.w) || !size(d.h)) return { ok: false, reason: `item ${d.id} has a bad position or size` };
  const base = { id: d.id, author: d.author as Author, x: d.x as number, y: d.y as number, w: d.w as number, h: d.h as number };
  if (d.kind === "note") {
    if (typeof d.text !== "string" || d.text.length > MAX_NOTE_CHARS) return { ok: false, reason: `note ${d.id} has bad text` };
    return { ok: true, value: { ...base, kind: "note", text: d.text } };
  }
  if (d.kind === "ink") {
    if (!Array.isArray(d.strokes) || d.strokes.length > MAX_STROKES) return { ok: false, reason: `ink ${d.id} has bad strokes` };
    const strokes: Stroke[] = [];
    for (const s of d.strokes as unknown[]) {
      const st = s as Record<string, unknown> | null;
      if (!st || !Array.isArray(st.points) || st.points.length > MAX_POINTS || st.points.length % 2 || !st.points.every(coord))
        return { ok: false, reason: `ink ${d.id} has a bad stroke` };
      if (typeof st.color !== "string" || !/^#[0-9a-f]{6}$/i.test(st.color) || !finite(st.width) || st.width <= 0 || st.width > 40)
        return { ok: false, reason: `ink ${d.id} has a bad pen` };
      strokes.push({ points: st.points as number[], color: st.color, width: st.width });
    }
    return { ok: true, value: { ...base, kind: "ink", strokes } };
  }
  if (d.kind === "sim") {
    if (typeof d.prompt !== "string" || !d.prompt.trim() || d.prompt.length > MAX_PROMPT_CHARS) return { ok: false, reason: `sim ${d.id} has no prompt` };
    let code: string | null = null;
    let params: SimParam[] = [];
    if (d.code !== null && d.code !== undefined) {
      if (typeof d.code !== "string") return { ok: false, reason: `sim ${d.id} has bad code` };
      const html = validateHtml(d.code);
      if (!html.ok) return { ok: false, reason: `sim ${d.id}: ${html.reason}` };
      const p = validateParams(d.params);
      if (!p.ok) return { ok: false, reason: `sim ${d.id}: ${p.reason}` };
      code = d.code;
      params = p.params;
    }
    const values: Record<string, number> = {};
    if (d.values && typeof d.values === "object")
      for (const [k, v] of Object.entries(d.values as Record<string, unknown>)) if (finite(v)) values[k] = v;
    const item: SimItem = {
      ...base,
      kind: "sim",
      prompt: d.prompt,
      code,
      title: typeof d.title === "string" ? d.title.slice(0, 200) : "",
      question: typeof d.question === "string" ? d.question.slice(0, 1000) : "",
      params,
      values,
    };
    const c = d.change as Record<string, unknown> | undefined;
    if (c && typeof c.request === "string" && c.request.trim() && finite(c.nonce))
      item.change = { request: c.request.slice(0, MAX_REQUEST_CHARS), nonce: c.nonce };
    if (typeof d.simId === "string" && /^[0-9a-f]{12}$/.test(d.simId)) item.simId = d.simId;
    return { ok: true, value: item };
  }
  return { ok: false, reason: `item ${d.id} has an unknown kind` };
}

export function checkItems(raw: unknown): Checked<BoardItem[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: "items is not an array" };
  if (raw.length > MAX_ITEMS) return { ok: false, reason: `the board has more than ${MAX_ITEMS} items` };
  const items: BoardItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const c = checkItem(r);
    if (!c.ok) return c;
    if (seen.has(c.value.id)) return { ok: false, reason: `item id ${c.value.id} is used twice` };
    seen.add(c.value.id);
    items.push(c.value);
  }
  return { ok: true, value: items };
}

// ---------- what Claude reads ----------

const round = (n: number) => Math.round(n);

/** The board as text for Claude: every item, who made it, where it is, and what it says. */
export function describeBoard(items: BoardItem[], view: View | null): string {
  const lines: string[] = [];
  if (view)
    lines.push(`The student is looking at x ${round(view.x)}–${round(view.x + view.w)}, y ${round(view.y)}–${round(view.y + view.h)}.`);
  if (!items.length) lines.push("The board is empty.");
  for (const it of items) {
    const where = `at x ${round(it.x)}, y ${round(it.y)}, size ${round(it.w)}×${round(it.h)}`;
    const head = `- [${it.id}] ${it.kind} by ${it.author} ${where}`;
    if (it.kind === "note") lines.push(`${head}: ${JSON.stringify(it.text)}`);
    else if (it.kind === "ink") lines.push(`${head}: handwriting or drawing, ${it.strokes.length} pen strokes (read it in the picture)`);
    else {
      const state = it.code ? "running" : "being generated";
      const sliders = it.params
        .map((p) => `${p.label} = ${it.values[p.id] ?? p.value} (range ${p.min}–${p.max})`)
        .join("; ");
      lines.push(
        `${head}: simulation box, ${state}. Asked for: ${JSON.stringify(it.prompt)}.` +
          (it.title ? ` Title: ${JSON.stringify(it.title)}.` : "") +
          (it.question ? ` Question: ${JSON.stringify(it.question)}.` : "") +
          (sliders ? ` Sliders: ${sliders}.` : ""),
      );
    }
  }
  return lines.join("\n");
}

// ---------- what Claude does ----------

export type BoardAction =
  | { type: "add_note"; text: string; x?: number; y?: number }
  | { type: "update_note"; id: string; text: string }
  | { type: "add_sim"; prompt: string; x?: number; y?: number }
  | { type: "edit_sim"; id: string; request: string }
  | { type: "move_item"; id: string; x: number; y: number }
  | { type: "delete_item"; id: string };

export const ACTION_TYPES = ["add_note", "update_note", "add_sim", "edit_sim", "move_item", "delete_item"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const optCoord = (v: unknown) => (v === undefined || v === null ? undefined : coord(v) ? (v as number) : null);

/** Check one action from the model (tool input or stand-in). */
export function parseAction(type: string, input: unknown): Checked<BoardAction> {
  const d = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bad = (why: string): Checked<BoardAction> => ({ ok: false, reason: `${type}: ${why}` });
  switch (type) {
    case "add_note":
    case "add_sim": {
      const text = str(type === "add_note" ? d.text : d.prompt, type === "add_note" ? MAX_NOTE_CHARS : MAX_REQUEST_CHARS);
      if (!text) return bad(type === "add_note" ? "needs text" : "needs a prompt");
      const x = optCoord(d.x);
      const y = optCoord(d.y);
      if (x === null || y === null) return bad("bad position");
      return type === "add_note"
        ? { ok: true, value: { type, text, x, y } }
        : { ok: true, value: { type, prompt: text, x, y } };
    }
    case "update_note": {
      const id = str(d.id, 24);
      const text = str(d.text, MAX_NOTE_CHARS);
      if (!id || !text) return bad("needs id and text");
      return { ok: true, value: { type, id, text } };
    }
    case "edit_sim": {
      const id = str(d.id, 24);
      const request = str(d.request, MAX_REQUEST_CHARS);
      if (!id || !request) return bad("needs id and request");
      return { ok: true, value: { type, id, request } };
    }
    case "move_item": {
      const id = str(d.id, 24);
      if (!id || !coord(d.x) || !coord(d.y)) return bad("needs id, x and y");
      return { ok: true, value: { type, id, x: d.x as number, y: d.y as number } };
    }
    case "delete_item": {
      const id = str(d.id, 24);
      if (!id) return bad("needs id");
      return { ok: true, value: { type, id } };
    }
    default:
      return { ok: false, reason: `unknown action ${type}` };
  }
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A free spot of size w×h, scanning the view (or the board's right edge) left to right, top to bottom. */
export function freeSpot(items: BoardItem[], w: number, h: number, view: View | null): { x: number; y: number } {
  const gap = 24;
  const area = view ?? { x: 0, y: 0, w: 1600, h: 1000 };
  const step = 40;
  const maxX = Math.max(area.x + gap, area.x + area.w - w - gap);
  const maxY = Math.max(area.y + gap, area.y + area.h - h - gap);
  for (let y = area.y + gap; y <= maxY; y += step) {
    for (let x = area.x + gap; x <= maxX; x += step) {
      const box = { x: x - gap / 2, y: y - gap / 2, w: w + gap, h: h + gap };
      if (!items.some((it) => overlaps(box, it))) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  const right = items.reduce((m, it) => Math.max(m, it.x + it.w), area.x);
  return { x: Math.round(right + gap * 2), y: Math.round(area.y + gap) };
}

/** The asked-for spot, or the first one below it that doesn't cover another item. */
export function clearOf(items: BoardItem[], box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  const gap = 16;
  let y = box.y;
  for (let i = 0; i < 100; i++) {
    const hit = items.find((it) => overlaps({ ...box, y }, it));
    if (!hit) break;
    y = hit.y + hit.h + gap;
  }
  return { x: Math.round(box.x), y: Math.round(y) };
}

export interface Applied {
  items: BoardItem[];
  /** Why the action was not applied, if it wasn't. */
  rejected?: string;
  /** The item the action created or changed. */
  itemId?: string;
}

/**
 * Apply one of Claude's actions. Claude may add anything, and may change, move or delete only items it made.
 * `id` makes new item ids (injectable for tests).
 */
export function applyAction(
  items: BoardItem[],
  action: BoardAction,
  view: View | null,
  id: () => string = newItemId,
): Applied {
  if (action.type === "add_note" || action.type === "add_sim") {
    if (items.length >= MAX_ITEMS) return { items, rejected: "the board is full" };
    const dims = action.type === "add_note" ? NOTE_SIZE : simSizeFor(view);
    const spot =
      action.x !== undefined && action.y !== undefined
        ? clearOf(items, { x: action.x, y: action.y, ...dims })
        : freeSpot(items, dims.w, dims.h, view);
    const base = { id: id(), author: "claude" as const, ...spot, ...dims };
    const item: BoardItem =
      action.type === "add_note"
        ? { ...base, kind: "note", text: action.text }
        : { ...base, kind: "sim", prompt: action.prompt, code: null, title: "", question: "", params: [], values: {} };
    return { items: [...items, item], itemId: item.id };
  }
  const target = items.find((it) => it.id === action.id);
  if (!target) return { items, rejected: `there is no item ${action.id}` };
  if (target.author !== "claude") return { items, rejected: `item ${action.id} was made by the student, so Claude can't change it` };
  const replace = (next: BoardItem) => ({ items: items.map((it) => (it.id === next.id ? next : it)), itemId: next.id });
  switch (action.type) {
    case "update_note":
      if (target.kind !== "note") return { items, rejected: `item ${action.id} is not a note` };
      return replace({ ...target, text: action.text });
    case "edit_sim":
      if (target.kind !== "sim") return { items, rejected: `item ${action.id} is not a simulation box` };
      if (!target.code) return { items, rejected: `simulation ${action.id} is still being generated` };
      return replace({ ...target, change: { request: action.request, nonce: (target.change?.nonce ?? 0) + 1 } });
    case "move_item":
      return replace(moveItem(target, action.x, action.y));
    case "delete_item":
      return { items: items.filter((it) => it.id !== action.id), itemId: action.id };
  }
}

/** A sim's prompt after an edit, so a saved sim describes what it now shows. Kept within MAX_PROMPT_CHARS. */
export function promptAfterEdit(prompt: string, request: string): string {
  const sep = " → ";
  const head = prompt.slice(0, Math.max(0, MAX_PROMPT_CHARS - sep.length - request.length));
  return `${head}${sep}${request}`.slice(0, MAX_PROMPT_CHARS);
}

const clampPos = (n: number) => Math.min(MAX_POS, Math.max(-MAX_POS, n));

/** Move an item to (x, y), kept within MAX_POS. Ink points are in board coordinates, so they move with it. */
export function moveItem(item: BoardItem, x: number, y: number): BoardItem {
  x = clampPos(x);
  y = clampPos(y);
  if (item.kind !== "ink") return { ...item, x, y };
  const dx = x - item.x;
  const dy = y - item.y;
  return {
    ...item,
    x,
    y,
    strokes: item.strokes.map((s) => ({ ...s, points: s.points.map((p, i) => p + (i % 2 ? dy : dx)) })),
  };
}

/** The bounding box of some strokes, padded by the pen width. */
export function strokesBox(strokes: Stroke[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pad = 0;
  for (const s of strokes) {
    pad = Math.max(pad, s.width);
    for (let i = 0; i < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i]);
      x1 = Math.max(x1, s.points[i]);
      y0 = Math.min(y0, s.points[i + 1]);
      y1 = Math.max(y1, s.points[i + 1]);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: MIN_SIZE, h: MIN_SIZE };
  const w = Math.max(MIN_SIZE, x1 - x0 + pad * 2);
  const h = Math.max(MIN_SIZE, y1 - y0 + pad * 2);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}
