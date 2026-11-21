"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyOps,
  checkItems,
  diffItems,
  eraseAt,
  freeSpot,
  MAX_ITEMS,
  MAX_POS,
  MAX_PROMPT_CHARS,
  MAX_STROKES,
  MAX_TITLE_CHARS,
  moveItem,
  newItemId,
  NOTE_SIZE,
  simSizeFor,
  strokesBox,
  type Board,
  type BoardItem,
  type InkItem,
  type SimItem,
  type View,
} from "@/lib/board";
import { renderBoardImage } from "@/lib/board-image";
import { readNdjson } from "@/lib/ndjson";
import { boardPetCue } from "@/lib/pets";
import type { BoardEvent, Stage } from "@/lib/types";
import { useStandInStatus } from "@/lib/useStandInStatus";
import { StandInBadge } from "./Badges";
import { rememberBoard } from "./BoardsHome";
import { BoardShareButton } from "./ShareButton";
import { ToolIcon } from "./ToolIcon";
import { PetPerch } from "./PetPerch";
import { PetPicker } from "./PetPicker";
import { InkView, StrokePaths } from "./board/InkView";
import { NoteView } from "./board/NoteView";
import { SimBox } from "./board/SimBox";

type Tool = "select" | "pen" | "erase" | "note";
type SaveState = "saved" | "saving" | "error";
interface Camera {
  x: number;
  y: number;
  s: number;
}
interface AskState {
  state: "idle" | "busy" | "done" | "error";
  stage: Stage | null;
  text: string;
  /** Claude's steps that didn't work, in its words or the board's. */
  rejected: string[];
  /** How many changes Claude made, once done. */
  changes?: number;
}

const PEN_COLORS = ["#121314", "#eb4b4b", "#4b69ff", "#3fb950"];
const PEN_WIDTH = 4;
/** Strokes drawn this soon after, and this close to, the last handwriting join it (one word or sketch = one item). */
const JOIN_MS = 1500;
const JOIN_GAP = 80;
const SAVE_DELAY_MS = 500;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
/** How often the page checks whether Claude or an MCP client changed the board. */
const POLL_MS = 2000;
const ERASER_RADIUS = 12;
const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: "select", label: "Select", key: "v" },
  { id: "pen", label: "Pen", key: "p" },
  { id: "erase", label: "Eraser", key: "e" },
  { id: "note", label: "Note", key: "n" },
];

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

/** Follow a pointer until it's released. Moves are reported as screen-pixel offsets from the start. */
function track(e: ReactPointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp?: () => void) {
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy, ev);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

export function BoardApp({ board }: { board: Board }) {
  const standIn = useStandInStatus();
  const [items, setItemsState] = useState<BoardItem[]>(board.items);
  const itemsRef = useRef(items);
  const [cam, setCamState] = useState<Camera>(() => {
    if (!board.items.length) return { x: 0, y: 0, s: 1 };
    return { x: Math.min(...board.items.map((i) => i.x)) - 40, y: Math.min(...board.items.map((i) => i.y)) - 90, s: 1 };
  });
  const camRef = useRef(cam);
  const [tool, setTool] = useState<Tool>("select");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penLeft, setPenLeft] = useState(12);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [simPrompt, setSimPrompt] = useState("");
  const [title, setTitle] = useState(board.title);
  const simDialog = useRef<HTMLDialogElement>(null);
  /** The board as the server last sent it: what the page's changes are measured against. */
  const base = useRef<BoardItem[]>(board.items);
  const version = useRef(board.version);
  const savedTitle = useRef(board.title);
  /** The title as typed, and whether it differs from the server's (so a sync doesn't overwrite it). */
  const titleRef = useRef(board.title);
  const titleDirty = useRef(false);
  /** The latest save, for retries scheduled from inside a save. */
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const [message, setMessage] = useState("");
  const [ask, setAsk] = useState<AskState>({ state: "idle", stage: null, text: "", rejected: [] });
  const viewport = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  // The colours sit under the Pen button, wherever the bar put it (also when picked with the P key).
  useEffect(() => {
    if (tool !== "pen") return;
    const r = header.current?.querySelector('[data-testid="tool-pen"]')?.getBoundingClientRect();
    if (r) setPenLeft(Math.max(12, r.left - 6));
  }, [tool]);
  const panel = useRef<HTMLElement>(null);
  const lastInk = useRef<{ id: string; at: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  // ---------- saving ----------

  /**
   * Take the server's board: the page's changes that the server hasn't seen yet are put back on top,
   * so they're neither lost nor sent twice. `sent` is what the page had when it sent its last change.
   */
  const sync = useCallback((server: Board, sent: BoardItem[] = base.current) => {
    const pending = diffItems(sent, itemsRef.current);
    base.current = server.items;
    version.current = server.version;
    savedTitle.current = server.title;
    const merged = applyOps(server.items, pending);
    itemsRef.current = merged;
    setItemsState(merged);
    setTitle((t) => (titleDirty.current ? t : server.title));
    return pending.length > 0;
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current;
    const sent = itemsRef.current;
    const ops = diffItems(base.current, sent);
    const newTitle = titleDirty.current ? titleRef.current : undefined;
    if (!ops.length && newTitle === undefined) {
      setSaveState("saved");
      return;
    }
    // The server rejects a change that breaks a limit, so check here and say why.
    const checked = checkItems(sent);
    if (!checked.ok) {
      console.warn("[board] not saving:", checked.reason);
      setSaveError(checked.reason);
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    titleDirty.current = false;
    const run = fetch(`/api/boards/${board.id}/ops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops, ...(newTitle !== undefined ? { title: newTitle } : {}) }),
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (Board & { error?: string }) | null;
        if (!r.ok || !j?.items) throw new Error(j?.error ?? `HTTP ${r.status}`);
        setSaveError("");
        const more = sync(j, sent);
        setSaveState(more || titleDirty.current ? "saving" : "saved");
        if (more || titleDirty.current) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
        }
      })
      .catch((err: unknown) => {
        if (newTitle !== undefined) titleDirty.current = true;
        console.warn("[board] save failed:", err instanceof Error ? err.message : err);
        setSaveError(err instanceof Error ? err.message : "");
        setSaveState("error");
      });
    saving.current = run;
    await run;
    saving.current = null;
  }, [board.id, sync]);
  useEffect(() => {
    saveRef.current = save;
  });

  // Claude (from another tab) or an MCP client may change the board: check for a newer version every few seconds.
  useEffect(() => {
    rememberBoard(board.id);
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || saving.current || document.hidden) return;
      try {
        const r = await fetch(`/api/boards/${board.id}?since=${version.current}`, { cache: "no-store" });
        if (r.status !== 200 || saving.current) return;
        const server = (await r.json()) as Board;
        if (server.version > version.current) sync(server);
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [board.id, sync]);

  function rename(next: string) {
    const t = next.slice(0, MAX_TITLE_CHARS);
    setTitle(t);
    titleRef.current = t;
    titleDirty.current = t.trim() !== savedTitle.current;
    if (titleDirty.current) {
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    }
  }

  const setItems = useCallback(
    (fn: (items: BoardItem[]) => BoardItem[]) => {
      const next = fn(itemsRef.current);
      if (next === itemsRef.current) return;
      itemsRef.current = next;
      setItemsState(next);
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save],
  );

  const patchItem = useCallback(
    (id: string, patch: Partial<BoardItem>) =>
      setItems((list) => {
        const it = list.find((i) => i.id === id);
        // Nothing changes: keep the same list, so there's no save.
        if (!it || Object.entries(patch).every(([k, v]) => Object.is((it as unknown as Record<string, unknown>)[k], v))) return list;
        return list.map((i) => (i.id === id ? ({ ...i, ...patch } as BoardItem) : i));
      }),
    [setItems],
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((list) => list.filter((it) => it.id !== id));
      setSelected((s) => (s === id ? null : s));
    },
    [setItems],
  );

  // ---------- camera ----------

  const setCam = useCallback((cam: Camera) => {
    // Kept near the origin, so everything drawn stays inside what the server accepts.
    const clamp = (n: number) => Math.min(MAX_POS, Math.max(-MAX_POS, n));
    const next = { ...cam, x: clamp(cam.x), y: clamp(cam.y) };
    camRef.current = next;
    setCamState(next);
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    const c = camRef.current;
    return { x: c.x + (clientX - (rect?.left ?? 0)) / c.s, y: c.y + (clientY - (rect?.top ?? 0)) / c.s };
  }, []);

  /** The part of the board on screen: below the toolbox bar and above the Ask Claude bar. */
  const currentView = useCallback((): View => {
    const rect = viewport.current?.getBoundingClientRect();
    const c = camRef.current;
    const top = Math.max(0, (header.current?.getBoundingClientRect().bottom ?? 60) - (rect?.top ?? 0));
    const bottom = panel.current ? panel.current.getBoundingClientRect().height + 24 : 0;
    const w = (rect?.width ?? 1280) / c.s;
    const h = Math.max(300, (rect?.height ?? 720) - top - bottom) / c.s;
    return { x: c.x, y: c.y + top / c.s, w, h };
  }, []);

  /** Pan just enough to show an item (its top-left corner, if it's bigger than the view). */
  const reveal = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      if (!it) return;
      const v = currentView();
      const c = camRef.current;
      // Too big for the view at this zoom (small screens): zoom out until it fits, top-left first.
      // On a phone only the width has to fit; the student pans down for the rest.
      const narrow = (viewport.current?.getBoundingClientRect().width ?? 1280) < 640;
      const needW = (it.w + 32 / c.s) / v.w;
      const need = narrow ? needW : Math.max(needW, (it.h + 32 / c.s) / v.h);
      if (need > 1) {
        const s = Math.max(MIN_ZOOM, c.s / need);
        const topPx = (v.y - c.y) * c.s;
        setCam({ x: it.x - 16 / s, y: it.y - 16 / s - topPx / s, s });
        return;
      }
      const m = 16 / c.s;
      let dx = 0;
      let dy = 0;
      if (it.x + it.w + m > v.x + v.w) dx = it.x + it.w + m - (v.x + v.w);
      if (it.x - m < v.x + dx) dx = it.x - m - v.x;
      if (it.y + it.h + m > v.y + v.h) dy = it.y + it.h + m - (v.y + v.h);
      if (it.y - m < v.y + dy) dy = it.y - m - v.y;
      if (dx || dy) setCam({ ...camRef.current, x: camRef.current.x + dx, y: camRef.current.y + dy });
    },
    [currentView, setCam],
  );

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const rect = viewport.current?.getBoundingClientRect();
      const c = camRef.current;
      const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.s * factor));
      const px = (clientX ?? (rect ? rect.left + rect.width / 2 : 0)) - (rect?.left ?? 0);
      const py = (clientY ?? (rect ? rect.top + rect.height / 2 : 0)) - (rect?.top ?? 0);
      const wx = c.x + px / c.s;
      const wy = c.y + py / c.s;
      setCam({ x: wx - px / s, y: wy - py / s, s });
    },
    [setCam],
  );

  // Wheel pans; ctrl/cmd + wheel (and trackpad pinch) zooms. Needs a non-passive listener to stop page zoom.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-scrolls]")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
      else {
        const c = camRef.current;
        setCam({ ...c, x: c.x + e.deltaX / c.s, y: c.y + e.deltaY / c.s });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setCam, zoomAt]);

  // Delete removes the selected item; Escape deselects and goes back to Select.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeItem(selected);
      } else if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
        else if (e.key.toLowerCase() === "s") simDialog.current?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removeItem]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // ---------- pointer on the empty board ----------

  function finishStroke(points: number[]) {
    const stroke = { points, color: penColor, width: PEN_WIDTH };
    const now = Date.now();
    const box = strokesBox([stroke]);
    setItems((list) => {
      const prev = lastInk.current && now - lastInk.current.at < JOIN_MS ? list.find((it) => it.id === lastInk.current!.id) : undefined;
      const near =
        prev &&
        box.x < prev.x + prev.w + JOIN_GAP &&
        prev.x < box.x + box.w + JOIN_GAP &&
        box.y < prev.y + prev.h + JOIN_GAP &&
        prev.y < box.y + box.h + JOIN_GAP;
      if (prev && prev.kind === "ink" && near && prev.strokes.length < MAX_STROKES) {
        const strokes = [...prev.strokes, stroke];
        lastInk.current = { id: prev.id, at: now };
        return list.map((it) => (it.id === prev.id ? { ...prev, strokes, ...strokesBox(strokes) } : it));
      }
      if (list.length >= MAX_ITEMS) return list;
      const ink: InkItem = { id: newItemId(), author: "student", kind: "ink", strokes: [stroke], ...box };
      lastInk.current = { id: ink.id, at: now };
      return [...list, ink];
    });
  }

  function onBoardPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== viewport.current && !target.dataset.world) return;
    const start = toWorld(e.clientX, e.clientY);
    if (tool === "pen") {
      e.preventDefault();
      const points = [start.x, start.y];
      setDrawing([...points]);
      track(
        e,
        (_dx, _dy, ev) => {
          const p = toWorld(ev.clientX, ev.clientY);
          const lx = points[points.length - 2];
          const ly = points[points.length - 1];
          if (Math.hypot(p.x - lx, p.y - ly) < 1.5 / camRef.current.s || points.length >= 3998) return;
          points.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
          setDrawing([...points]);
        },
        () => {
          setDrawing(null);
          finishStroke(points);
        },
      );
      return;
    }
    if (tool === "erase") {
      e.preventDefault();
      const r = ERASER_RADIUS / camRef.current.s;
      let last = start;
      setItems((list) => eraseAt(list, start.x, start.y, r));
      track(e, (_dx, _dy, ev) => {
        const p = toWorld(ev.clientX, ev.clientY);
        // A fast swipe reports few positions; erase along the line between them too.
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (r / 2)));
        const from = last;
        setItems((list) => {
          let out = list;
          for (let i = 1; i <= steps; i++) out = eraseAt(out, from.x + ((p.x - from.x) * i) / steps, from.y + ((p.y - from.y) * i) / steps, r);
          return out;
        });
        last = p;
      });
      return;
    }
    if (tool === "note") {
      if (full) return;
      // Without this, the click's mousedown moves focus back to the page after the new note took it.
      e.preventDefault();
      const note: BoardItem = {
        id: newItemId(),
        author: "student",
        kind: "note",
        text: "",
        x: Math.round(start.x - NOTE_SIZE.w / 2),
        y: Math.round(start.y - 20),
        ...NOTE_SIZE,
      };
      setItems((list) => [...list, note]);
      setSelected(note.id);
      setFocusNote(note.id);
      setTool("select");
      return;
    }
    setSelected(null);
    const c0 = camRef.current;
    track(e, (dx, dy) => setCam({ ...c0, x: c0.x - dx / c0.s, y: c0.y - dy / c0.s }));
  }

  // ---------- dragging and resizing items ----------

  function startDrag(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    if (tool === "pen" || tool === "erase") return;
    e.stopPropagation();
    e.preventDefault();
    const item = itemsRef.current.find((it) => it.id === id);
    if (!item) return;
    setSelected(id);
    setDragging(true);
    const s = camRef.current.s;
    track(
      e,
      (dx, dy) => setItems((list) => list.map((it) => (it.id === id ? moveItem(item, Math.round(item.x + dx / s), Math.round(item.y + dy / s)) : it))),
      () => setDragging(false),
    );
  }

  function startResize(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const item = itemsRef.current.find((it) => it.id === id);
    if (!item || item.kind === "ink") return;
    e.preventDefault();
    setSelected(id);
    setDragging(true);
    const min = item.kind === "sim" ? { w: 480, h: 380 } : { w: 160, h: 100 };
    const s = camRef.current.s;
    track(
      e,
      (dx, dy) =>
        patchItem(id, { w: Math.max(min.w, Math.round(item.w + dx / s)), h: Math.max(min.h, Math.round(item.h + dy / s)) }),
      () => setDragging(false),
    );
  }

  // ---------- adding things from the toolbar ----------

  function addSim(fields: Pick<SimItem, "prompt"> & Partial<SimItem>) {
    if (itemsRef.current.length >= MAX_ITEMS) return;
    const view = currentView();
    const size = simSizeFor(view);
    const spot = freeSpot(itemsRef.current, size.w, size.h, view);
    const sim: SimItem = {
      id: newItemId(),
      author: "student",
      kind: "sim",
      code: null,
      title: "",
      question: "",
      params: [],
      values: {},
      ...spot,
      ...size,
      ...fields,
    };
    setItems((list) => [...list, sim]);
    setSelected(sim.id);
    reveal(sim.id);
  }

  function addSimFromPrompt() {
    const prompt = simPrompt.trim();
    if (!prompt || full) return;
    setSimPrompt("");
    simDialog.current?.close();
    setTool("select");
    addSim({ prompt });
  }

  // ---------- Ask Claude ----------

  async function askClaude() {
    if (ask.state === "busy") return;
    setAsk({ state: "busy", stage: null, text: "", rejected: [] });
    // Claude reads the stored board, so the page's latest changes go first.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await save();
    const view = currentView();
    let image: string | null = null;
    try {
      image = renderBoardImage(itemsRef.current);
    } catch (err) {
      console.warn("[board] couldn't draw the board picture:", err);
    }
    const rejected: string[] = [];
    let made = 0;
    try {
      const res = await fetch(`/api/boards/${board.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view, message, image }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `The server answered ${res.status}.`);
      }
      const before = new Set(itemsRef.current.map((it) => it.id));
      for await (const ev of readNdjson<BoardEvent>(res.body)) {
        if (ev.type === "status") setAsk((a) => ({ ...a, stage: ev.stage }));
        else if (ev.type === "tool") {
          if (!ev.ok) rejected.push(ev.text);
          else if (ev.name !== "get_board" && ev.name !== "get_changelog") made++;
        } else if (ev.type === "board") {
          if (sync(ev.board)) void save();
          const added = ev.board.items.find((it) => !before.has(it.id));
          if (added) {
            before.add(added.id);
            reveal(added.id);
          }
        } else if (ev.type === "error") throw new Error(ev.message);
      }
      setMessage("");
      setAsk({
        state: "done",
        stage: null,
        changes: made,
        text: made ? `Claude made ${made} change${made === 1 ? "" : "s"} on the board.` : "Claude didn't change anything.",
        rejected,
      });
    } catch (err) {
      setAsk({ state: "error", stage: null, text: err instanceof Error ? err.message : "Something went wrong.", rejected });
    }
  }

  const full = items.length >= MAX_ITEMS;

  const askLabel =
    ask.state === "busy"
      ? ask.stage === "writing"
        ? "Claude is writing on the board…"
        : "Claude is reading the board…"
      : ask.text;

  // ---------- render ----------

  return (
    // overflow-clip, not hidden: a hidden box still scrolls when focus lands on something past its edge.
    <div className="relative h-screen w-screen overflow-clip bg-paper" data-board-id={board.id}>
      <div
        ref={viewport}
        className={`board-viewport absolute inset-0 overflow-clip ${
          tool === "pen" ? "pen-mode cursor-crosshair" : tool === "erase" ? "pen-mode erase-mode" : tool === "note" ? "cursor-copy" : "cursor-default"
        } ${
          dragging ? "is-dragging" : ""
        }`}
        style={{ backgroundPosition: `${-cam.x * cam.s}px ${-cam.y * cam.s}px`, backgroundSize: `${40 * cam.s}px ${40 * cam.s}px` }}
        onPointerDown={onBoardPointerDown}
        data-testid="board"
        data-tool={tool}
      >
        <div
          data-world="1"
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${-cam.x * cam.s}px, ${-cam.y * cam.s}px) scale(${cam.s})` }}
        >
          {items.map((it) => (
            // The wrapper lets the pointer through; the item inside takes it (except handwriting under the pen or eraser).
            <div key={it.id} className="pointer-events-none absolute" style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
              {it.kind === "note" ? (
                <NoteView
                  item={it}
                  selected={selected === it.id}
                  autoFocus={focusNote === it.id}
                  onText={(text) => patchItem(it.id, { text })}
                  onDragStart={(e) => startDrag(e, it.id)}
                  onResizeStart={(e) => startResize(e, it.id)}
                  onDelete={() => removeItem(it.id)}
                />
              ) : it.kind === "ink" ? (
                <InkView item={it} selected={selected === it.id} onDragStart={(e) => startDrag(e, it.id)} />
              ) : (
                <SimBox
                  item={it}
                  selected={selected === it.id}
                  onPatch={(patch) => patchItem(it.id, patch)}
                  onDragStart={(e) => startDrag(e, it.id)}
                  onResizeStart={(e) => startResize(e, it.id)}
                  onDelete={() => removeItem(it.id)}
                />
              )}
            </div>
          ))}
          {drawing ? (
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              <StrokePaths strokes={[{ points: drawing, color: penColor, width: PEN_WIDTH }]} />
            </svg>
          ) : null}
        </div>
        {!items.length ? (
          <p className="pointer-events-none absolute inset-x-0 top-[40%] px-6 text-center text-[1.2rem] font-medium text-[#55595e]">
            Write with Pen, type with Note, or add a simulation from the bar above. Then press “Ask Claude”.
          </p>
        ) : null}
      </div>

      <header ref={header} className="toolbar absolute left-3 right-3 top-3" role="toolbar" aria-label="Whiteboard tools">
        <Link href="/" className="tool-btn" data-testid="boards-link" title="My whiteboards">
          <ToolIcon name="back" />
          <span className="tool-label">Boards</span>
        </Link>
        <input
          className="board-title"
          aria-label="Board title"
          data-testid="board-title"
          value={title}
          maxLength={MAX_TITLE_CHARS}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => {
            if (!title.trim()) rename(savedTitle.current);
          }}
        />
        <span className="toolbar-sep" aria-hidden />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tool-btn"
            aria-pressed={tool === t.id}
            data-testid={`tool-${t.id}`}
            title={`${t.label} (${t.key.toUpperCase()})`}
            onClick={() => setTool(t.id)}
          >
            <ToolIcon name={t.id} />
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="tool-btn"
          data-testid="tool-sim"
          title="Add simulation (S)"
          disabled={full}
          onClick={() => simDialog.current?.showModal()}
        >
          <ToolIcon name="sim" />
          <span className="tool-label">Simulation</span>
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button type="button" className="tool-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          <ToolIcon name="minus" />
        </button>
        <button type="button" className="tool-btn tabular-nums" aria-label="Reset zoom" title="Reset zoom" onClick={() => zoomAt(1 / cam.s)}>
          {Math.round(cam.s * 100)}%
        </button>
        <button type="button" className="tool-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(1.25)}>
          <ToolIcon name="plus" />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <BoardShareButton boardId={board.id} />
        <span className="flex-1" />
        {full ? (
          <span className="kicker text-danger" data-testid="board-full" title={`Board full (${MAX_ITEMS} items): delete something to add more`}>
            Full
          </span>
        ) : null}
        <StandInBadge standIn={standIn} compact />
        <span
          className="kicker"
          data-testid="save-state"
          data-state={saveState}
          role="status"
          title={saveState === "error" && saveError ? saveError : undefined}
        >
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Couldn't save"}
        </span>
        <PetPicker />
      </header>

      {tool === "pen" ? (
        // The colours hang under the bar, so picking the pen never pushes the bar's other buttons out of view.
        <div className="toolbar absolute top-[3.6rem] z-10" style={{ left: penLeft }} role="group" aria-label="Pen colour" data-testid="pen-colours">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="tool-swatch"
              style={{ background: c }}
              aria-label={`Pen colour ${c}`}
              aria-pressed={penColor === c}
              onClick={() => setPenColor(c)}
            />
          ))}
        </div>
      ) : null}

      <dialog ref={simDialog} className="card m-auto w-[min(34rem,calc(100vw-2rem))] p-0 text-text backdrop:bg-black/40" data-testid="sim-dialog">
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            addSimFromPrompt();
          }}
        >
          <label htmlFor="sim-prompt" className="kicker">
            Add a simulation
          </label>
          <textarea
            id="sim-prompt"
            className="field min-h-[5em] resize-none"
            data-testid="prompt-input"
            placeholder="What should it show? e.g. “Does a heavier pendulum swing faster?”"
            value={simPrompt}
            maxLength={MAX_PROMPT_CHARS}
            autoFocus
            onChange={(e) => setSimPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addSimFromPrompt();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => simDialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" data-testid="create-button" disabled={!simPrompt.trim() || full}>
              Generate
            </button>
          </div>
        </form>
      </dialog>

      <aside
        ref={panel}
        className="toolbar absolute bottom-3 right-3 w-[min(24rem,calc(100vw-1.5rem))] flex-col !flex-nowrap !items-stretch !overflow-visible shadow-[4px_4px_0_var(--blue)]"
        aria-label="Ask Claude"
        data-scrolls="1"
      >
        <PetPerch className="absolute bottom-full right-3" cue={boardPetCue(ask)} fadeNear />
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void askClaude();
          }}
        >
          <input
            className="field h-[2.1rem] min-w-0 flex-1 px-2 py-0 shadow-none"
            aria-label="Message for Claude (optional)"
            data-testid="ask-input"
            placeholder="Ask Claude (optional message)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="submit" className="tool-btn" aria-pressed={ask.state === "busy"} data-testid="ask-button" disabled={ask.state === "busy"}>
            {ask.state === "busy" ? "Working…" : "Ask Claude"}
          </button>
        </form>
        {askLabel ? (
          <div
            className={`max-h-[7rem] overflow-y-auto px-1 text-base font-semibold leading-snug ${ask.state === "error" ? "text-danger" : "text-text"}`}
            data-testid="ask-status"
            data-state={ask.state}
            role={ask.state === "error" ? "alert" : "status"}
          >
            {askLabel}
            {ask.rejected.length ? (
              <ul className="mt-1 list-disc pl-5 font-normal text-muted">
                {ask.rejected.map((r, i) => (
                  <li key={i}>Skipped: {r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
