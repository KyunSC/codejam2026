import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  applyAction,
  checkItems,
  describeBoard,
  freeSpot,
  moveItem,
  parseAction,
  SIM_SIZE,
  strokesBox,
  type BoardItem,
  type InkItem,
  type NoteItem,
  type SimItem,
} from "./board";
import { BOARD_TOOLS } from "./prompts";

const pendulum = readFileSync("fixtures/sims/pendulum.html", "utf8");
const params = [{ id: "massA", label: "Bob A mass (kg)", min: 0.5, max: 10, step: 0.5, value: 1 }];

const note = (id: string, author: "student" | "claude", over: Partial<NoteItem> = {}): NoteItem => ({
  id, author, kind: "note", text: "hello", x: 0, y: 0, w: 320, h: 200, ...over,
});
const sim = (id: string, author: "student" | "claude", over: Partial<SimItem> = {}): SimItem => ({
  id, author, kind: "sim", prompt: "Does a heavier pendulum swing faster?", code: pendulum, title: "Two Pendulums",
  question: "Which first?", params, values: { massA: 2 }, x: 400, y: 0, w: 780, h: 520, ...over,
});
const ink = (id: string): InkItem => ({
  id, author: "student", kind: "ink", x: 8, y: 8, w: 104, h: 64,
  strokes: [{ points: [10, 10, 110, 70], color: "#0f172a", width: 4 }],
});
let n = 0;
const ids = () => `new${++n}`;

describe("checkItems", () => {
  it("accepts notes, ink and sims, with or without code", () => {
    const items = [note("a", "student"), ink("b"), sim("c", "claude"), sim("d", "student", { code: null, params: [] })];
    const r = checkItems(JSON.parse(JSON.stringify(items)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(items);
  });

  it("rejects bad items", () => {
    expect(checkItems("nope").ok).toBe(false);
    expect(checkItems([note("a", "student"), note("a", "student")]).ok).toBe(false);
    expect(checkItems([{ ...note("a", "student"), author: "teacher" }]).ok).toBe(false);
    expect(checkItems([{ ...note("a", "student"), x: Infinity }]).ok).toBe(false);
    expect(checkItems([{ ...note("A!", "student") }]).ok).toBe(false);
    expect(checkItems([{ ...note("a", "student"), kind: "video" }]).ok).toBe(false);
    expect(checkItems([sim("a", "claude", { code: "<script src=https://x.y/z.js></script>" })]).ok).toBe(false);
    expect(checkItems([{ ...ink("a"), strokes: [{ points: [1, 2, 3], color: "#000000", width: 4 }] }]).ok).toBe(false);
    expect(checkItems([{ ...ink("a"), strokes: [{ points: [1, 2], color: "red", width: 4 }] }]).ok).toBe(false);
  });
});

describe("describeBoard", () => {
  it("lists every item with its author, place and content, and the view", () => {
    const text = describeBoard([note("a", "student", { text: "Why?" }), ink("b"), sim("c", "claude")], { x: 0, y: 100, w: 800, h: 600 });
    expect(text).toContain("looking at x 0–800, y 100–700");
    expect(text).toContain('[a] note by student at x 0, y 0, size 320×200: "Why?"');
    expect(text).toContain("[b] ink by student");
    expect(text).toContain("read it in the picture");
    expect(text).toContain("[c] sim by claude");
    expect(text).toContain("Bob A mass (kg) = 2 (range 0.5–10)");
    expect(describeBoard([], null)).toBe("The board is empty.");
  });
});

describe("parseAction", () => {
  it("checks each action's input", () => {
    expect(parseAction("add_note", { text: "Hi" })).toEqual({ ok: true, value: { type: "add_note", text: "Hi", x: undefined, y: undefined } });
    expect(parseAction("add_note", { text: "  " }).ok).toBe(false);
    expect(parseAction("add_sim", { prompt: "Pendulums", x: 5, y: 6 })).toEqual({ ok: true, value: { type: "add_sim", prompt: "Pendulums", x: 5, y: 6 } });
    expect(parseAction("add_sim", { prompt: "p", x: "left" }).ok).toBe(false);
    expect(parseAction("edit_sim", { id: "c" }).ok).toBe(false);
    expect(parseAction("move_item", { id: "c", x: 1 }).ok).toBe(false);
    expect(parseAction("delete_item", { id: "c" }).ok).toBe(true);
    expect(parseAction("format_disk", {}).ok).toBe(false);
  });

  it("has a tool for every action and nothing else", () => {
    expect(BOARD_TOOLS.map((t) => t.name).sort()).toEqual([...ACTION_TYPES].sort());
  });
});

describe("applyAction", () => {
  const board: BoardItem[] = [note("s1", "student"), note("c1", "claude", { x: 0, y: 300 }), sim("cs", "claude"), sim("ss", "student", { y: 600 })];

  it("adds notes and sims by Claude, in a free spot when no position is given", () => {
    const view = { x: 0, y: 0, w: 2000, h: 1400 };
    const a = applyAction(board, { type: "add_sim", prompt: "Ramps" }, view, ids);
    const added = a.items.at(-1) as SimItem;
    expect(added).toMatchObject({ author: "claude", kind: "sim", prompt: "Ramps", code: null, ...SIM_SIZE });
    for (const other of board)
      expect(added.x >= other.x + other.w || other.x >= added.x + added.w || added.y >= other.y + other.h || other.y >= added.y + added.h).toBe(true);
  });

  it("moves an asked-for spot down when it would cover another item", () => {
    const a = applyAction(board, { type: "add_note", text: "Hi", x: 0, y: 0 }, null, ids);
    expect(a.items.at(-1)).toMatchObject({ x: 0, y: 516 });
  });

  it("lets Claude change, move and delete only its own items", () => {
    expect(applyAction(board, { type: "update_note", id: "c1", text: "new" }, null).items[1]).toMatchObject({ text: "new" });
    expect(applyAction(board, { type: "update_note", id: "s1", text: "new" }, null).rejected).toMatch(/made by the student/);
    expect(applyAction(board, { type: "delete_item", id: "s1" }, null).rejected).toMatch(/made by the student/);
    expect(applyAction(board, { type: "edit_sim", id: "ss", request: "x" }, null).rejected).toMatch(/made by the student/);
    expect(applyAction(board, { type: "move_item", id: "c1", x: 9, y: 9 }, null).items[1]).toMatchObject({ x: 9, y: 9 });
    expect(applyAction(board, { type: "delete_item", id: "c1" }, null).items.map((i) => i.id)).toEqual(["s1", "cs", "ss"]);
    expect(applyAction(board, { type: "delete_item", id: "zz" }, null).rejected).toMatch(/no item zz/);
  });

  it("queues a change on Claude's sim, counting up so the same request can run twice", () => {
    const once = applyAction(board, { type: "edit_sim", id: "cs", request: "heavier" }, null);
    expect((once.items[2] as SimItem).change).toEqual({ request: "heavier", nonce: 1 });
    const twice = applyAction(once.items, { type: "edit_sim", id: "cs", request: "heavier" }, null);
    expect((twice.items[2] as SimItem).change).toEqual({ request: "heavier", nonce: 2 });
    const pending = [sim("p", "claude", { code: null })];
    expect(applyAction(pending, { type: "edit_sim", id: "p", request: "x" }, null).rejected).toMatch(/still being generated/);
    expect(applyAction(board, { type: "edit_sim", id: "c1", request: "x" }, null).rejected).toMatch(/not a simulation/);
  });
});

describe("geometry", () => {
  it("moves handwriting points with the item", () => {
    const moved = moveItem(ink("i"), 18, 28) as InkItem;
    expect(moved.strokes[0].points).toEqual([20, 30, 120, 90]);
  });

  it("boxes strokes with the pen width as padding", () => {
    expect(strokesBox(ink("i").strokes)).toEqual({ x: 6, y: 6, w: 108, h: 68 });
  });

  it("finds a free spot in the view, or right of everything when the view is full", () => {
    expect(freeSpot([], 100, 100, { x: 50, y: 50, w: 500, h: 500 })).toEqual({ x: 74, y: 74 });
    const full = [note("a", "student", { x: 0, y: 0, w: 600, h: 600 })];
    expect(freeSpot(full, 300, 300, { x: 0, y: 0, w: 600, h: 600 })).toEqual({ x: 648, y: 24 });
  });
});
