"use client";

// The session state machine shared by generate, edit, demos and the student page:
//   idle → streaming → mounting → ready, with repairing and failed.
// The first failure of produced code triggers one /api/repair and a remount; a second
// failure (or a model/API error with no code to repair) ends in failed.
import { useCallback, useEffect, useRef, useState } from "react";
import { buildSrcdoc, defaultValues, validateParams } from "./bridge";
import { readNdjson } from "./ndjson";
import { startingValues } from "./params";
import { extractHtml, validateHtml } from "./sim-html";
import type { BridgeMessage, SessionState, SimParam, Stage, StreamEvent, Usage } from "./types";

/** Bridge errors this soon after `ready` still count as a failed mount. */
export const POST_READY_WINDOW_MS = 2000;
/** If the bridge never answers (e.g. a frozen script), give up after this long. */
export const MOUNT_TIMEOUT_MS = 8000;
const TAIL_LINES = 8;

export interface Timings {
  submit: number | null;
  firstDelta: number | null;
  streamDone: number | null;
  ready: number | null;
}

export interface ReadyInfo {
  code: string;
  title: string;
  question: string;
  params: SimParam[];
  kind: RunKind;
}

export type RunKind = "generate" | "edit" | "load";

export interface EditBase {
  code: string;
  params: SimParam[];
  values: Record<string, number>;
}

export interface SessionView {
  state: SessionState;
  stage: Stage | null;
  lineCount: number;
  codeTail: string;
  elapsedMs: number;
  srcdoc: string | null;
  mountKey: number;
  code: string | null;
  title: string;
  question: string;
  params: SimParam[];
  values: Record<string, number>;
  error: string | null;
  errorDetail: string | null;
  interactiveMs: number | null;
  appliedCount: number;
  usage: Usage | null;
}

const EMPTY: SessionView = {
  state: "idle",
  stage: null,
  lineCount: 0,
  codeTail: "",
  elapsedMs: 0,
  srcdoc: null,
  mountKey: 0,
  code: null,
  title: "",
  question: "",
  params: [],
  values: {},
  error: null,
  errorDetail: null,
  interactiveMs: null,
  appliedCount: 0,
  usage: null,
};

interface Run {
  id: number;
  kind: RunKind;
  abort: AbortController;
  timings: Timings;
  code: string | null;
  readyAt: number | null;
  pendingSet: boolean;
  initial?: Record<string, number>;
  carry?: { values: Record<string, number>; defaults: Record<string, number> };
  watchdog: ReturnType<typeof setTimeout> | null;
  repaired: boolean;
  usage: Usage | null;
  /** The last document we tried to mount, valid or not: what a repair starts from. */
  attempted: string | null;
}

/** One machine-readable line per finished run, for scripts/try-topics.ts. */
function logRun(run: Run, outcome: "ready" | "failed", detail?: string) {
  const t = run.timings;
  const since = (x: number | null) => (x === null || t.submit === null ? null : Math.round(x - t.submit));
  console.log(
    "[sim] run " +
      JSON.stringify({
        kind: run.kind,
        outcome,
        firstDeltaMs: since(t.firstDelta),
        streamDoneMs: since(t.streamDone),
        readyMs: since(t.ready),
        inputTokens: run.usage?.input_tokens ?? null,
        outputTokens: run.usage?.output_tokens ?? null,
        repaired: run.repaired,
        detail: detail ?? null,
      }),
  );
}

export interface SessionOptions {
  onReady?: (info: ReadyInfo) => void;
}

export function useSimSession(options: SessionOptions = {}) {
  const [view, setView] = useState<SessionView>(EMPTY);
  const viewRef = useRef(view);
  const runRef = useRef<Run | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const optionsRef = useRef(options);
  const nextId = useRef(1);

  useEffect(() => {
    optionsRef.current = options;
  });

  // viewRef is the machine's source of truth and is updated synchronously, so a bridge
  // message that arrives before React re-renders still sees the current state.
  const update = useCallback((patch: Partial<SessionView> | ((v: SessionView) => Partial<SessionView>)) => {
    const prev = viewRef.current;
    const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
    viewRef.current = next;
    setView(next);
  }, []);

  const isCurrent = (run: Run) => runRef.current?.id === run.id && !run.abort.signal.aborted;

  const clearWatchdog = (run: Run) => {
    if (run.watchdog) clearTimeout(run.watchdog);
    run.watchdog = null;
  };

  // Set from an effect below; lets mount/onBridge reach the repair path without a dependency cycle.
  const failRef = useRef<(run: Run, message: string) => void>(() => {});

  /** Terminal failure: no repair. */
  const giveUp = useCallback(
    (run: Run, message: string) => {
      if (!isCurrent(run)) return;
      clearWatchdog(run);
      console.warn("[sim] failed:", message);
      logRun(run, "failed", message);
      update({
        state: "failed",
        srcdoc: null,
        error: "This simulation didn't work. Try again, or describe the confusion a little differently.",
        errorDetail: message,
      });
    },
    [update],
  );

  const mount = useCallback(
    (run: Run, raw: string) => {
      if (!isCurrent(run)) return;
      const html = extractHtml(raw);
      run.attempted = html || raw.trim() || null;
      const check = validateHtml(html);
      if (!check.ok) return failRef.current(run, check.reason);
      run.code = html;
      run.readyAt = null;
      run.pendingSet = false;
      clearWatchdog(run);
      run.watchdog = setTimeout(() => {
        if (isCurrent(run) && run.readyAt === null) failRef.current(run, "The simulation didn't start in time.");
      }, MOUNT_TIMEOUT_MS);
      update((v) => ({ state: "mounting", srcdoc: buildSrcdoc(html), mountKey: v.mountKey + 1 }));
    },
    [update],
  );

  const begin = useCallback(
    (kind: RunKind, extra: Partial<Run> = {}): Run => {
      runRef.current?.abort.abort();
      if (runRef.current) clearWatchdog(runRef.current);
      const run: Run = {
        id: nextId.current++,
        kind,
        abort: new AbortController(),
        timings: { submit: performance.now(), firstDelta: null, streamDone: null, ready: null },
        code: null,
        readyAt: null,
        pendingSet: false,
        watchdog: null,
        repaired: false,
        usage: null,
        attempted: null,
        ...extra,
      };
      runRef.current = run;
      return run;
    },
    [],
  );

  /** Stream a model call and return the raw text, or null if it failed/was superseded. */
  const stream = useCallback(
    async (
      run: Run,
      endpoint: string,
      body: object,
      shown: "streaming" | "repairing" = "streaming",
    ): Promise<string | null> => {
      update({ state: shown, stage: null, lineCount: 0, codeTail: "", error: null, errorDetail: null });
      let text = "";
      let lastPaint = 0;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: run.abort.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          giveUp(run, j?.error ?? `The server answered ${res.status}.`);
          return null;
        }
        for await (const ev of readNdjson<StreamEvent>(res.body)) {
          if (!isCurrent(run)) return null;
          if (ev.type === "status") update({ stage: ev.stage });
          else if (ev.type === "delta") {
            if (run.timings.firstDelta === null) run.timings.firstDelta = performance.now();
            text += ev.text;
            const now = performance.now();
            if (now - lastPaint > 80) {
              lastPaint = now;
              const lines = text.split("\n");
              update({ lineCount: lines.length, codeTail: lines.slice(-TAIL_LINES).join("\n") });
            }
          } else if (ev.type === "done") {
            run.timings.streamDone = performance.now();
            run.usage = ev.usage;
            const lines = text.split("\n");
            update({ lineCount: lines.length, codeTail: lines.slice(-TAIL_LINES).join("\n"), usage: ev.usage });
          } else if (ev.type === "error") {
            giveUp(run, ev.message);
            return null;
          }
        }
      } catch (err) {
        if (run.abort.signal.aborted) return null;
        giveUp(run, err instanceof Error ? err.message : "The connection dropped.");
        return null;
      }
      if (run.timings.streamDone === null) run.timings.streamDone = performance.now();
      return text;
    },
    [giveUp, update],
  );

  /** Any failure of produced code: one repair, then give up. */
  const fail = useCallback(
    (run: Run, message: string) => {
      if (!isCurrent(run)) return;
      clearWatchdog(run);
      const code = run.attempted;
      if (run.repaired || !code) return giveUp(run, message);
      run.repaired = true;
      run.readyAt = null;
      run.pendingSet = false;
      console.warn("[sim] repairing after:", message);
      update({ state: "repairing", srcdoc: null, errorDetail: message });
      void (async () => {
        const text = await stream(run, "/api/repair", { code, error: message }, "repairing");
        if (text !== null) mount(run, text);
      })();
    },
    [giveUp, mount, stream, update],
  );

  useEffect(() => {
    failRef.current = fail;
  });

  const generate = useCallback(
    async (prompt: string) => {
      const run = begin("generate");
      update({ ...EMPTY, mountKey: viewRef.current.mountKey, state: "streaming" });
      const text = await stream(run, "/api/generate", { prompt });
      if (text !== null) mount(run, text);
    },
    [begin, mount, stream, update],
  );

  /** What an edit starts from: the current sim, captured so a failed edit can be retried. */
  const snapshot = useCallback((): EditBase | null => {
    const v = viewRef.current;
    if (v.state !== "ready" || !v.code) return null;
    return { code: v.code, params: v.params, values: { ...v.values } };
  }, []);

  /** Ask for a change to the current sim. Untouched sliders take the new defaults; moved ones carry over. */
  const edit = useCallback(
    async (request: string, base: EditBase | null = snapshot()) => {
      if (!base) return;
      const run = begin("edit", { carry: { values: base.values, defaults: defaultValues(base.params) } });
      update({ ...EMPTY, mountKey: viewRef.current.mountKey, state: "streaming" });
      const text = await stream(run, "/api/edit", { code: base.code, request });
      if (text !== null) mount(run, text);
    },
    [begin, mount, snapshot, stream, update],
  );

  /** Mount known-good code with no model call (demos, student page). */
  const load = useCallback(
    (code: string, opts: { initial?: Record<string, number> } = {}) => {
      const run = begin("load", { initial: opts.initial });
      update({ ...EMPTY, mountKey: viewRef.current.mountKey });
      mount(run, code);
    },
    [begin, mount, update],
  );

  const postValues = useCallback((run: Run, values: Record<string, number>) => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    run.pendingSet = true;
    win.postMessage({ type: "setParams", values }, "*");
  }, []);

  const onBridge = useCallback(
    (msg: BridgeMessage) => {
      const run = runRef.current;
      if (!run || !isCurrent(run)) return;
      const state = viewRef.current.state;
      if (msg.type === "ready") {
        if (state !== "mounting") return;
        const checked = validateParams(msg.params);
        if (!checked.ok) return failRef.current(run, checked.reason);
        clearWatchdog(run);
        run.readyAt = performance.now();
        run.timings.ready = run.readyAt;
        const params = checked.params;
        const values = startingValues(params, { initial: run.initial, carry: run.carry });
        const title = typeof msg.title === "string" && msg.title.trim() ? msg.title : "Simulation";
        const question = typeof msg.question === "string" ? msg.question : "";
        const t = run.timings;
        const since = (x: number | null) => (x === null || t.submit === null ? null : Math.round(x - t.submit));
        console.log(
          `[sim] timings (ms from submit): submit=0 firstDelta=${since(t.firstDelta)} streamDone=${since(t.streamDone)} ready=${since(t.ready)}`,
        );
        logRun(run, "ready");
        update({
          state: "ready",
          title,
          question,
          params,
          values,
          code: run.code,
          interactiveMs: since(t.ready),
          error: null,
          errorDetail: null,
        });
        const defaults = defaultValues(params);
        if (Object.keys(values).some((k) => values[k] !== defaults[k])) postValues(run, values);
        if (run.code) optionsRef.current.onReady?.({ code: run.code, title, question, params, kind: run.kind });
        return;
      }
      if (msg.type === "applied") {
        run.pendingSet = false;
        update((v) => ({ appliedCount: v.appliedCount + 1 }));
        return;
      }
      // error
      const where = msg.line ? ` (line ${msg.line}${msg.col ? `, col ${msg.col}` : ""})` : "";
      const detail = msg.message + where;
      if (state === "mounting") return failRef.current(run, detail);
      if (state === "ready") {
        const recent = run.readyAt !== null && performance.now() - run.readyAt < POST_READY_WINDOW_MS;
        if (recent || run.pendingSet) return failRef.current(run, detail);
        console.warn("[sim] runtime error after ready (ignored):", detail);
      }
    },
    [postValues, update],
  );

  const setValue = useCallback(
    (id: string, value: number) => {
      const run = runRef.current;
      if (!run || viewRef.current.state !== "ready") return;
      const values = { ...viewRef.current.values, [id]: value };
      update({ values });
      postValues(run, values);
    },
    [postValues, update],
  );

  const reset = useCallback(() => {
    runRef.current?.abort.abort();
    if (runRef.current) clearWatchdog(runRef.current);
    runRef.current = null;
    update({ ...EMPTY, mountKey: viewRef.current.mountKey });
  }, [update]);

  // Elapsed-time ticker while work is in progress.
  const busy = view.state === "streaming" || view.state === "mounting" || view.state === "repairing";
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      const start = runRef.current?.timings.submit;
      if (start != null) update({ elapsedMs: performance.now() - start });
    }, 100);
    return () => clearInterval(timer);
  }, [busy, update]);

  useEffect(
    () => () => {
      runRef.current?.abort.abort();
      if (runRef.current) clearWatchdog(runRef.current);
    },
    [],
  );

  return { view, frameRef, generate, edit, snapshot, load, setValue, onBridge, reset };
}

export type SimSession = ReturnType<typeof useSimSession>;
