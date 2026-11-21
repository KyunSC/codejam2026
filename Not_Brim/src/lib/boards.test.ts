import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteItem } from "./board";
import { BOARD_ID, createBoardStore, EMPTY_BOARD_TTL_MS } from "./boards";

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

  it("drops boards left empty for a day when a new one is made", async () => {
    const file = path.join(dir, "boards.json");
    const old = new Date(Date.now() - EMPTY_BOARD_TTL_MS - 1000).toISOString();
    const recent = new Date().toISOString();
    await writeFile(
      file,
      JSON.stringify([
        { id: "aaaaaaaaaaaa", items: [], createdAt: old, updatedAt: old },
        { id: "bbbbbbbbbbbb", items: [note], createdAt: old, updatedAt: old },
        { id: "cccccccccccc", items: [], createdAt: recent, updatedAt: recent },
      ]),
    );
    const s = createBoardStore(file);
    const made = await s.createBoard();
    const ids = (JSON.parse(await readFile(file, "utf8")) as { id: string }[]).map((b) => b.id);
    expect(ids).toEqual(["bbbbbbbbbbbb", "cccccccccccc", made.id]);
  });
});
