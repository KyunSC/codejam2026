import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Board, BoardItem } from "./board";
import { newId } from "./store";

export const BOARD_ID = /^[0-9a-f]{12}$/;
/** Empty boards older than this are dropped when a new board is made. */
export const EMPTY_BOARD_TTL_MS = 24 * 60 * 60 * 1000;

/** Boards in one JSON file. Writes are serialised in-process and atomic on disk (tmp file + rename). */
export function createBoardStore(file: string) {
  let queue: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<Board[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as Board[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async function writeAll(boards: Board[]) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(boards));
    await rename(tmp, file);
  }

  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  }

  return {
    createBoard(): Promise<Board> {
      return locked(async () => {
        const now = Date.now();
        // Boards left empty for a day were opened and abandoned; dropping them keeps the file from growing forever.
        const boards = (await readAll()).filter(
          (b) => b.items.length > 0 || now - Date.parse(b.updatedAt) < EMPTY_BOARD_TTL_MS,
        );
        const stamp = new Date(now).toISOString();
        const board: Board = { id: newId(), items: [], createdAt: stamp, updatedAt: stamp };
        boards.push(board);
        await writeAll(boards);
        return board;
      });
    },
    async getBoard(id: string): Promise<Board | null> {
      await queue;
      return (await readAll()).find((b) => b.id === id) ?? null;
    },
    saveItems(id: string, items: BoardItem[]): Promise<Board | null> {
      return locked(async () => {
        const boards = await readAll();
        const i = boards.findIndex((b) => b.id === id);
        if (i < 0) return null;
        boards[i] = { ...boards[i], items, updatedAt: new Date().toISOString() };
        await writeAll(boards);
        return boards[i];
      });
    },
  };
}

export type BoardStore = ReturnType<typeof createBoardStore>;

let defaultStore: BoardStore | null = null;

/** The app's boards at data/boards.json. */
export function boardStore(): BoardStore {
  defaultStore ??= createBoardStore(path.join(process.cwd(), "data", "boards.json"));
  return defaultStore;
}
