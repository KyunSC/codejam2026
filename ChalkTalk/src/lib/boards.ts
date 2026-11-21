import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Board, BoardItem } from "./board";
import { assertFileStorageWritable, db, type Db } from "./db";
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
      assertFileStorageWritable();
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
      assertFileStorageWritable();
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

interface BoardRow {
  id: string;
  items: BoardItem[];
  created_at: Date;
  updated_at: Date;
}

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  items: r.items,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Boards in Postgres (table livesim_boards), for deployments without a lasting disk. */
export function createPgBoardStore({ pool, ready }: Db): BoardStore {
  return {
    async createBoard() {
      await ready;
      await pool.query(
        "DELETE FROM livesim_boards WHERE jsonb_array_length(items) = 0 AND updated_at < now() - make_interval(secs => $1)",
        [EMPTY_BOARD_TTL_MS / 1000],
      );
      const { rows } = await pool.query<BoardRow>(
        "INSERT INTO livesim_boards (id, items, created_at, updated_at) VALUES ($1, '[]'::jsonb, now(), now()) RETURNING *",
        [newId()],
      );
      return toBoard(rows[0]);
    },
    async getBoard(id) {
      await ready;
      const { rows } = await pool.query<BoardRow>("SELECT * FROM livesim_boards WHERE id = $1", [id]);
      return rows[0] ? toBoard(rows[0]) : null;
    },
    async saveItems(id, items) {
      await ready;
      const { rows } = await pool.query<BoardRow>(
        "UPDATE livesim_boards SET items = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *",
        [id, JSON.stringify(items)],
      );
      return rows[0] ? toBoard(rows[0]) : null;
    },
  };
}

let defaultStore: BoardStore | null = null;

/** The app's boards: Postgres when DATABASE_URL is set, data/boards.json otherwise. */
export function boardStore(): BoardStore {
  if (!defaultStore) {
    const database = db();
    defaultStore = database
      ? createPgBoardStore(database)
      : createBoardStore(path.join(process.cwd(), "data", "boards.json"));
  }
  return defaultStore;
}
