import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TITLE, MAX_LOG, MAX_TITLE_CHARS, type Board, type BoardItem, type BoardSummary, type LogEntry } from "./board";
import { assertFileStorageWritable, db, type Db } from "./db";
import { newId } from "./store";

export const BOARD_ID = /^[0-9a-f]{12}$/;
/** Empty boards older than this are dropped when a new board is made. */
export const EMPTY_BOARD_TTL_MS = 24 * 60 * 60 * 1000;

export interface NewBoard {
  title?: string;
  items?: BoardItem[];
  log?: LogEntry[];
}

/** What a change returns: the parts of the board to replace. Null leaves the board as it was. */
export type BoardChange = (board: Board) => { items?: BoardItem[]; title?: string; log?: LogEntry[] } | null;

export interface BoardStore {
  createBoard(init?: NewBoard): Promise<Board>;
  getBoard(id: string): Promise<Board | null>;
  /** Summaries of the boards with these ids that exist, most recently changed first. */
  listBoards(ids: string[]): Promise<BoardSummary[]>;
  /** Read, change and write one board atomically; the version rises by one. Null when there's no such board. */
  change(id: string, fn: BoardChange): Promise<Board | null>;
}

const cleanTitle = (t: string | undefined) => (t ?? "").trim().slice(0, MAX_TITLE_CHARS) || DEFAULT_TITLE;

/** Boards saved before titles, versions and changelogs existed get the defaults. */
function normalize(b: Partial<Board> & { id: string; items: BoardItem[]; createdAt: string; updatedAt: string }): Board {
  return { ...b, title: b.title || DEFAULT_TITLE, version: b.version ?? 0, log: b.log ?? [] };
}

const summary = (b: Board): BoardSummary => ({ id: b.id, title: b.title, itemCount: b.items.length, updatedAt: b.updatedAt });

/** Boards in one JSON file. Writes are serialised in-process and atomic on disk (tmp file + rename). */
export function createBoardStore(file: string): BoardStore {
  let queue: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<Board[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as Board[]).map(normalize) : [];
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
    createBoard(init = {}) {
      assertFileStorageWritable();
      return locked(async () => {
        const now = Date.now();
        // Boards left empty for a day were opened and abandoned; dropping them keeps the file from growing forever.
        const boards = (await readAll()).filter(
          (b) => b.items.length > 0 || now - Date.parse(b.updatedAt) < EMPTY_BOARD_TTL_MS,
        );
        const stamp = new Date(now).toISOString();
        const board: Board = {
          id: newId(),
          title: cleanTitle(init.title),
          items: init.items ?? [],
          version: 0,
          log: (init.log ?? []).slice(-MAX_LOG),
          createdAt: stamp,
          updatedAt: stamp,
        };
        boards.push(board);
        await writeAll(boards);
        return board;
      });
    },
    async getBoard(id) {
      await queue;
      return (await readAll()).find((b) => b.id === id) ?? null;
    },
    async listBoards(ids) {
      await queue;
      const wanted = new Set(ids);
      return (await readAll())
        .filter((b) => wanted.has(b.id))
        .map(summary)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    change(id, fn) {
      assertFileStorageWritable();
      return locked(async () => {
        const boards = await readAll();
        const i = boards.findIndex((b) => b.id === id);
        if (i < 0) return null;
        const patch = fn(boards[i]);
        if (!patch) return boards[i];
        boards[i] = {
          ...boards[i],
          ...(patch.items ? { items: patch.items } : {}),
          ...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
          ...(patch.log ? { log: patch.log.slice(-MAX_LOG) } : {}),
          version: boards[i].version + 1,
          updatedAt: new Date().toISOString(),
        };
        await writeAll(boards);
        return boards[i];
      });
    },
  };
}

interface BoardRow {
  id: string;
  title: string | null;
  items: BoardItem[];
  version: number | null;
  log: LogEntry[] | null;
  created_at: Date;
  updated_at: Date;
}

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  title: r.title || DEFAULT_TITLE,
  items: r.items,
  version: r.version ?? 0,
  log: r.log ?? [],
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Boards in Postgres (table livesim_boards), for deployments without a lasting disk. */
export function createPgBoardStore({ pool, ready }: Db): BoardStore {
  return {
    async createBoard(init = {}) {
      await ready;
      await pool.query(
        "DELETE FROM livesim_boards WHERE jsonb_array_length(items) = 0 AND updated_at < now() - make_interval(secs => $1)",
        [EMPTY_BOARD_TTL_MS / 1000],
      );
      const { rows } = await pool.query<BoardRow>(
        `INSERT INTO livesim_boards (id, title, items, version, log, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 0, $4::jsonb, now(), now()) RETURNING *`,
        [newId(), cleanTitle(init.title), JSON.stringify(init.items ?? []), JSON.stringify((init.log ?? []).slice(-MAX_LOG))],
      );
      return toBoard(rows[0]);
    },
    async getBoard(id) {
      await ready;
      const { rows } = await pool.query<BoardRow>("SELECT * FROM livesim_boards WHERE id = $1", [id]);
      return rows[0] ? toBoard(rows[0]) : null;
    },
    async listBoards(ids) {
      await ready;
      if (!ids.length) return [];
      const { rows } = await pool.query<BoardRow>(
        "SELECT * FROM livesim_boards WHERE id = ANY($1::text[]) ORDER BY updated_at DESC",
        [ids],
      );
      return rows.map((r) => summary(toBoard(r)));
    },
    async change(id, fn) {
      await ready;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<BoardRow>("SELECT * FROM livesim_boards WHERE id = $1 FOR UPDATE", [id]);
        if (!rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        const board = toBoard(rows[0]);
        const patch = fn(board);
        if (!patch) {
          await client.query("ROLLBACK");
          return board;
        }
        const next = await client.query<BoardRow>(
          `UPDATE livesim_boards SET items = $2::jsonb, title = $3, log = $4::jsonb, version = $5, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [
            id,
            JSON.stringify(patch.items ?? board.items),
            patch.title !== undefined ? cleanTitle(patch.title) : board.title,
            JSON.stringify((patch.log ?? board.log).slice(-MAX_LOG)),
            board.version + 1,
          ],
        );
        await client.query("COMMIT");
        return toBoard(next.rows[0]);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
