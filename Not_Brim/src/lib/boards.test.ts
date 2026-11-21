import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteItem } from "./board";
import { BOARD_ID, createBoardStore } from "./boards";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "boards-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const note: NoteItem = { id: "a1", author: "student", kind: "note", text: "Why?", x: 0, y: 0, w: 320, h: 200 };

describe("board store", () => {
  it("creates, gets and saves boards", async () => {
    const s = createBoardStore(path.join(dir, "nested", "boards.json"));
    expect(await s.getBoard("000000000000")).toBeNull();
    const b = await s.createBoard();
    expect(b.id).toMatch(BOARD_ID);
    expect(b.items).toEqual([]);
    const saved = await s.saveItems(b.id, [note]);
    expect(saved?.items).toEqual([note]);
    expect((await s.getBoard(b.id))?.items).toEqual([note]);
    expect(await s.saveItems("000000000000", [])).toBeNull();
  });

  it("serialises concurrent saves and leaves no temp files", async () => {
    const s = createBoardStore(path.join(dir, "boards.json"));
    const boards = await Promise.all(Array.from({ length: 10 }, () => s.createBoard()));
    await Promise.all(boards.map((b, i) => s.saveItems(b.id, [{ ...note, text: String(i) }])));
    for (const [i, b] of boards.entries()) expect(((await s.getBoard(b.id))?.items[0] as NoteItem).text).toBe(String(i));
    expect(await readdir(dir)).toEqual(["boards.json"]);
  });
});
