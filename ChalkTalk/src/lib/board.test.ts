import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  appendLog,
  applyAction,
  applyOps,
  describeChange,
  diffItems,
  eraseAt,
  checkItems,
  describeBoard,
  freeSpot,
  MAX_POS,
  MAX_PROMPT_CHARS,
  moveItem,
  parseAction,
  promptAfterEdit,
  SIM_SIZE,
  strokesBox,
  type BoardItem,
  type InkItem,
  type NoteItem,
  type SimItem,
} from "./board";
import { BOARD_TOOLS } from "./board-tool-defs";

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

  it("has a tool for every action, plus reading the board and changelog and renaming it", () => {
    expect(BOARD_TOOLS.map((t) => t.name).sort()).toEqual([...ACTION_TYPES, "get_board", "get_changelog", "rename_board"].sort());
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

  it("lets Claude change, move and delete any item, the student's included", () => {
    expect(applyAction(board, { type: "update_note", id: "c1", text: "new" }, null).items[1]).toMatchObject({ text: "new" });
    expect(applyAction(board, { type: "update_note", id: "s1", text: "new" }, null).items[0]).toMatchObject({ text: "new", author: "student" });
    expect(applyAction(board, { type: "delete_item", id: "s1" }, null).items.map((i) => i.id)).toEqual(["c1", "cs", "ss"]);
    expect((applyAction(board, { type: "edit_sim", id: "ss", request: "x" }, null).items[3] as SimItem).change?.request).toBe("x");
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

  it("keeps counting up after a change has run (the box keeps `change`, it doesn't clear it)", () => {
    const ran = applyAction(board, { type: "edit_sim", id: "cs", request: "heavier" }, null);
    // The box runs nonce 1 and leaves `change` in place; Claude's next request must be a new nonce.
    const next = applyAction(ran.items, { type: "edit_sim", id: "cs", request: "slower" }, null);
    expect((next.items[2] as SimItem).change).toEqual({ request: "slower", nonce: 2 });
  });
});

describe("geometry", () => {
  it("keeps moved items within MAX_POS", () => {
    expect(moveItem(note("n", "student"), 10 * MAX_POS, -10 * MAX_POS)).toMatchObject({ x: MAX_POS, y: -MAX_POS });
    const far = moveItem(ink("i"), 10 * MAX_POS, 0);
    expect(checkItems([far]).ok).toBe(true);
  });

  it("adds an edit to a sim's prompt, within the prompt limit", () => {
    expect(promptAfterEdit("pendulum", "make it a spring")).toBe("pendulum → make it a spring");
    const long = promptAfterEdit("p".repeat(MAX_PROMPT_CHARS), "spring");
    expect(long.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(long.endsWith(" → spring")).toBe(true);
  });

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

describe("set_sliders", () => {
  it("sets a running sim's sliders within range and refuses unknown sliders", () => {
    const items: BoardItem[] = [sim("cs", "claude")];
    const set = applyAction(items, { type: "set_sliders", id: "cs", values: { massA: 99 } }, null);
    expect((set.items[0] as SimItem).values).toEqual({ massA: 10 });
    expect(applyAction(items, { type: "set_sliders", id: "cs", values: { nope: 1 } }, null).rejected).toMatch(/no slider nope/);
    expect(applyAction([sim("p", "claude", { code: null })], { type: "set_sliders", id: "p", values: { massA: 2 } }, null).rejected).toMatch(/still being generated/);
  });
});

describe("ops and changelog", () => {
  const a = note("a1", "student", { text: "one" });
  const b = note("b2", "claude", { text: "two", y: 300 });

  it("diffs two item lists into puts and deletes, and applies them on top of newer items", () => {
    const edited = { ...a, text: "ONE" };
    const ops = diffItems([a, b], [edited, ink("c3")]);
    expect(ops).toEqual([{ type: "put", item: edited }, { type: "put", item: ink("c3") }, { type: "delete", id: "b2" }]);
    // Someone else added d4 meanwhile: it survives.
    const theirs = note("d4", "claude");
    expect(applyOps([a, b, theirs], ops).map((i) => i.id)).toEqual(["a1", "d4", "c3"]);
    expect(diffItems([a], [a])).toEqual([]);
  });

  it("describes changes for Claude, and folds repeated moves of one item into one entry", () => {
    expect(describeChange(undefined, a, "student")?.text).toBe('The student added note [a1]: "one".');
    expect(describeChange(a, { ...a, text: "new" }, "claude")?.text).toBe('Claude edited note [a1]: "new".');
    expect(describeChange(a, undefined, "student")?.text).toBe("The student deleted note [a1].");
    expect(describeChange(sim("s", "student", { code: null }), sim("s", "student"), "student")).toMatchObject({ author: "app", text: 'Simulation [s] is ready: "Two Pendulums".' });
    const m1 = describeChange(a, { ...a, x: 50 }, "student")!;
    const m2 = describeChange(a, { ...a, x: 90 }, "student")!;
    expect(appendLog([], [m1, m2])).toEqual([m2]);
    expect(appendLog([m1], [describeChange(undefined, b, "claude")!])).toHaveLength(2);
  });

  it("erases the strokes the eraser touches, and drops handwriting with none left", () => {
    expect(eraseAt([ink("i")], 60, 40, 5)).toEqual([]);
    const two: InkItem = { ...ink("i"), strokes: [...ink("i").strokes, { points: [10, 200, 110, 200], color: "#0f172a", width: 4 }] };
    const left = eraseAt([two], 60, 40, 5) as InkItem[];
    expect(left[0].strokes).toHaveLength(1);
    expect(eraseAt([ink("i")], 500, 500, 5)).toEqual([ink("i")]);
  });
});
