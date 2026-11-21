import "server-only";

import {
  appendLog,
  applyAction,
  describeBoard,
  describeChange,
  describeLog,
  diffItems,
  MAX_LOG,
  parseAction,
  type Board,
  type BoardItem,
  type LogAuthor,
  type LogEntry,
  type View,
} from "./board";
import { boardStore } from "./boards";

export interface ToolResult {
  text: string;
  isError: boolean;
  /** The board after the tool, when it changed it. */
  board?: Board;
}

/** Changelog entries for everything that differs between two item lists. */
export function logEntriesFor(before: BoardItem[], after: BoardItem[], author: LogAuthor): LogEntry[] {
  const old = new Map(before.map((it) => [it.id, it]));
  const entries: LogEntry[] = [];
  for (const op of diffItems(before, after)) {
    const e =
      op.type === "delete" ? describeChange(old.get(op.id), undefined, author) : describeChange(old.get(op.item.id), op.item, author);
    if (e) entries.push(e);
  }
  return entries;
}

/** The board as text: title, items and where to open it. */
export function boardText(board: Board, view: View | null = null): string {
  return [`Board ${board.id}: ${JSON.stringify(board.title)} (version ${board.version}, open at /b/${board.id})`, describeBoard(board.items, view)].join(
    "\n",
  );
}

/**
 * Run one board tool for Claude (from Ask Claude or an MCP client). Changes are applied to the stored board
 * atomically and written to its changelog as Claude's.
 */
export async function runBoardTool(boardId: string, name: string, input: unknown, view: View | null = null): Promise<ToolResult> {
  const store = boardStore();
  const fail = (text: string): ToolResult => ({ text, isError: true });

  if (name === "get_board") {
    const board = await store.getBoard(boardId);
    return board ? { text: boardText(board, view), isError: false } : fail(`There is no board ${boardId}.`);
  }
  if (name === "get_changelog") {
    const board = await store.getBoard(boardId);
    if (!board) return fail(`There is no board ${boardId}.`);
    const raw = (input as { limit?: unknown } | null)?.limit;
    const limit = typeof raw === "number" && raw > 0 ? Math.min(MAX_LOG, Math.floor(raw)) : 40;
    return { text: describeLog(board.log, limit), isError: false };
  }
  if (name === "rename_board") {
    const title = (input as { title?: unknown } | null)?.title;
    if (typeof title !== "string" || !title.trim()) return fail("rename_board needs a title.");
    const board = await store.change(boardId, (b) => ({
      title,
      log: appendLog(b.log, [{ at: new Date().toISOString(), author: "claude", text: `Claude renamed the board to ${JSON.stringify(title.trim())}.` }]),
    }));
    return board ? { text: `Renamed to ${JSON.stringify(board.title)}.`, isError: false, board } : fail(`There is no board ${boardId}.`);
  }

  const parsed = parseAction(name, input);
  if (!parsed.ok) return fail(parsed.reason);
  let rejected: string | undefined;
  let itemId: string | undefined;
  const board = await store.change(boardId, (b) => {
    const applied = applyAction(b.items, parsed.value, view);
    if (applied.rejected) {
      rejected = applied.rejected;
      return null;
    }
    itemId = applied.itemId;
    return { items: applied.items, log: appendLog(b.log, logEntriesFor(b.items, applied.items, "claude")) };
  });
  if (!board) return fail(`There is no board ${boardId}.`);
  if (rejected) return fail(rejected);
  const done = name.startsWith("add_") ? `Done: added [${itemId}].` : `Done: ${name} on [${itemId}].`;
  return { text: done, isError: false, board };
}
