import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoardItem } from "../board";
import type { BoardEvent, StreamEvent } from "../types";
import { StandInModel, bumpFirstDefault, oneStep, standInActions } from "./standin";

const fast = new StandInModel({ timing: { thinkMs: 0, chunks: 40, writeMs: 0 } });

async function collect(it: AsyncIterable<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of it) events.push(e);
  const code = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
  return { events, code };
}

describe("fixtures", () => {
  const files = readdirSync("fixtures/sims").filter((f) => f.endsWith(".html"));

  it("has every fixture the spec lists", () => {
    for (const name of [
      "pendulum", "pendulum-edited", "falling", "falling-broken", "throws-broken", "throws",
      "no-sim", "bad-params", "external-script", "throws-twice", "throws-twice-2",
    ]) {
      expect(files).toContain(`${name}.html`);
    }
  });

  it("marks each one hand-made with its own name, and avoids reserved topics", () => {
    for (const f of files) {
      const html = readFileSync(`fixtures/sims/${f}`, "utf8");
      expect(StandInModel.nameOf(html)).toBe(f.replace(/\.html$/, ""));
      expect(html).toMatch(/hand-made/);
      expect(html).not.toMatch(/projectile|spring|elastic|collision/i);
    }
  });
});

describe("StandInModel", () => {
  it("streams thinking, writing, ~40 deltas, then done", async () => {
    const { events, code } = await collect(fast.generate("why does a pendulum swing"));
    expect(events[0]).toEqual({ type: "status", stage: "thinking" });
    expect(events[1]).toEqual({ type: "status", stage: "writing" });
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(39);
    expect(deltas.length).toBeLessThanOrEqual(41);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.usage.output_tokens).toBeGreaterThan(0);
    expect(code).toBe(fast.load("pendulum"));
  });

  it("paces roughly 1.5 s thinking + 3 s writing by default", async () => {
    const slow = new StandInModel({ timing: { thinkMs: 150, chunks: 40, writeMs: 300 } });
    const t0 = Date.now();
    await collect(slow.generate("x"));
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(420);
    expect(ms).toBeLessThan(2000);
  });

  it("picks fixtures by keyword, falls back to pendulum, honours [[fixture:NAME]]", () => {
    expect(fast.pick("Why do heavy things fall faster?")).toBe("falling");
    expect(fast.pick("blocks sliding down a ramp")).toBe("throws");
    expect(fast.pick("something unrelated entirely")).toBe("pendulum");
    expect(fast.pick("[[fixture:no-sim]] anything")).toBe("no-sim");
    expect(fast.pick("[[fixture:does-not-exist]] ramp")).toBe("throws");
  });

  it("repairs X-broken to X, throws-twice to the still-broken throws-twice-2", async () => {
    expect((await collect(fast.repair(fast.load("throws-broken"), "boom"))).code).toBe(fast.load("throws"));
    expect((await collect(fast.repair(fast.load("falling-broken"), "boom"))).code).toBe(fast.load("falling"));
    expect((await collect(fast.repair(fast.load("throws-twice"), "boom"))).code).toBe(fast.load("throws-twice-2"));
  });

  it("edits to NAME-edited when it exists, else bumps the first default", async () => {
    expect((await collect(fast.edit(fast.load("pendulum"), "make bob B twice as heavy"))).code).toBe(
      fast.load("pendulum-edited"),
    );
    const falling = (await collect(fast.edit(fast.load("falling"), "slower"))).code;
    expect(falling).toContain("{id:'massA',label:'Ball A mass (kg)',min:0.1,max:10,step:0.1,value:0.6}");
  });

  it("homework is deterministic and stays in range", async () => {
    const params = [
      { id: "a", label: "A", min: 0, max: 10, step: 1, value: 3 },
      { id: "b", label: "B", min: 0, max: 1, step: 0.1, value: 1 },
    ];
    const hw = await fast.homework({ code: "", params, question: "q", title: "Two Things" });
    expect(hw.defaults).toEqual({ a: 4, b: 0.9 });
    expect(hw.question).toContain("Two Things");
    expect(await fast.homework({ code: "", params, question: "q", title: "Two Things" })).toEqual(hw);
  });
});

describe("helpers", () => {
  it("oneStep keeps within range and on the grid", () => {
    expect(oneStep(0.5, 0.1, 10, 0.1)).toBe(0.6);
    expect(oneStep(10, 0, 10, 0.5)).toBe(9.5);
    expect(oneStep(1, 1, 1.5, 1)).toBe(1);
  });

  it("bumpFirstDefault leaves documents without params alone", () => {
    expect(bumpFirstDefault("<html></html>")).toBe("<html></html>");
  });
});

describe("boardTurn", () => {
  const board = new StandInModel({ timing: { boardMs: 0 } });
  const has = (n: string) => board.has(n);
  const studentNote = (text: string): BoardItem => ({ id: "n1", author: "student", kind: "note", text, x: 10, y: 20, w: 320, h: 200 });

  it("streams status, then runs its actions as board tools, then done", async () => {
    const events: BoardEvent[] = [];
    const calls: Array<[string, unknown]> = [];
    const turn = board.boardTurn({
      board: { id: "b", title: "t", version: 0, log: [], createdAt: "", updatedAt: "", items: [studentNote("Does a heavier pendulum swing faster?")] },
      view: null,
      message: "",
      image: null,
      runTool: async (name, input) => {
        calls.push([name, input]);
        return { text: "Done", isError: false };
      },
    });
    for await (const e of turn) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["status", "status", "tool", "tool", "done"]);
    expect(calls.map(([n]) => n)).toEqual(["add_note", "add_sim"]);
    expect(calls[1][1]).toEqual({ prompt: "Does a heavier pendulum swing faster?" });
  });

  it("replies beside the student's note and adds a sim when the note names a topic", () => {
    const actions = standInActions([studentNote("Does a heavier pendulum swing faster?")], "", has);
    expect(actions[0]).toMatchObject({ type: "add_note", x: 354, y: 20 });
    expect(actions[0].type === "add_note" && actions[0].text).toContain('I read your note: "Does a heavier pendulum swing faster?"');
    expect(actions[1]).toEqual({ type: "add_sim", prompt: "Does a heavier pendulum swing faster?" });
  });

  it("doesn't add a second sim on the same topic, and asks for a prediction instead", () => {
    const items: BoardItem[] = [
      studentNote("Does a heavier pendulum swing faster?"),
      { id: "s1", author: "claude", kind: "sim", prompt: "pendulum mass", code: null, title: "", question: "", params: [], values: {}, x: 0, y: 0, w: 780, h: 520 },
    ];
    const actions = standInActions(items, "", has);
    expect(actions).toHaveLength(1);
    expect(actions[0].type === "add_note" && actions[0].text).toContain("What do you predict");
  });

  it("forces a fixture with [[fixture:NAME]] and edits Claude's newest sim on 'change:'", () => {
    expect(standInActions([], "Why? [[fixture:throws-broken]]", has).at(-1)).toEqual({
      type: "add_sim",
      prompt: "Why? [[fixture:throws-broken]]",
    });
    const mine: BoardItem = {
      id: "s9", author: "claude", kind: "sim", prompt: "p", code: "<html></html>", title: "", question: "", params: [], values: {}, x: 0, y: 0, w: 780, h: 520,
    };
    expect(standInActions([mine], "change: make bob B twice as heavy", has)[0]).toEqual({
      type: "edit_sim",
      id: "s9",
      request: "make bob B twice as heavy",
    });
  });

  it("says when it can't read handwriting, and what to do on an empty board", () => {
    const ink: BoardItem = { id: "i1", author: "student", kind: "ink", strokes: [{ points: [0, 0, 5, 5], color: "#000000", width: 4 }], x: 0, y: 0, w: 40, h: 40 };
    expect(JSON.stringify(standInActions([ink], "", has))).toContain("can't read handwriting");
    expect(JSON.stringify(standInActions([], "", has))).toContain("The board is empty");
  });
});

describe("drawing offline", () => {
  it("answers 'draw …' with a sketch through the draw tool, in [x, y] pairs", async () => {
    const model = new StandInModel({ timing: { boardMs: 0 } });
    const calls: Array<[string, unknown]> = [];
    const turn = model.boardTurn({
      board: { id: "b", title: "t", version: 0, log: [], createdAt: "", updatedAt: "", items: [] },
      view: null,
      message: "draw a horse",
      image: null,
      runTool: async (name, input) => {
        calls.push([name, input]);
        return { text: "Done", isError: false };
      },
    });
    for await (const e of turn) void e;
    expect(calls.map(([n]) => n)).toEqual(["draw", "add_note"]);
    const input = calls[0][1] as { strokes: Array<{ points: number[][]; color: string }> };
    expect(input.strokes[0].points[0]).toEqual([40, 190]);
    expect(input.strokes[1].color).toBe("red");
  });
});
