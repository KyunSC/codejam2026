import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resolvePreferences, sanitizePreferences, type ResolvedPreferences, type StoredPreferences } from "@/lib/preferences";
import { call } from "./api";
import { useSession } from "./session";
import type { User } from "@/lib/types";

// The signed-in user's dashboard preferences, from /api/me/preferences.
// Changes apply at once (resolved locally with the same code the server uses) and are saved after a short pause.
// A copy is kept in localStorage so the dashboard opens in the user's layout before the server answers.

type View = { stored: StoredPreferences; resolved: ResolvedPreferences };
export type SaveState = "idle" | "saving" | "saved" | "error";

type PrefsCtx = {
  prefs: ResolvedPreferences; // always complete: the defaults until loaded
  update: (fn: (s: StoredPreferences) => StoredPreferences) => void;
  undo: () => void;
  canUndo: boolean;
  reset: () => void;
  saveState: SaveState;
  retry: () => void;
};

const SAVE_DELAY_MS = 400;
const UNDO_LIMIT = 60;
const userKey = (id: string) => `brim:prefs:${id}`;

const store = {
  get(key: string): unknown {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // private window or blocked storage: the server copy still applies
    }
  },
};

const Ctx = createContext<PrefsCtx | null>(null);

// One provider per signed-in user (keyed by user id), so signing in as someone else starts from fresh state.
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  return <UserPreferences key={user?.user_id ?? "signed-out"} user={user}>{children}</UserPreferences>;
}

function UserPreferences({ user, children }: { user: User | null; children: React.ReactNode }) {
  const userId = user?.user_id ?? null;
  const [stored, setStored] = useState<StoredPreferences>(() => (userId ? sanitizePreferences(store.get(userKey(userId))) : {}));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [undoDepth, setUndoDepth] = useState(0);
  const latest = useRef<StoredPreferences>(stored);
  const undoStack = useRef<StoredPreferences[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefs = useMemo(() => resolvePreferences(stored, user), [stored, user]);

  // the server copy, once per signed-in user
  useEffect(() => {
    if (!userId) return;
    let live = true;
    call<View>("GET", "/api/me/preferences").then(
      (v) => {
        if (!live) return;
        latest.current = v.stored;
        setStored(v.stored);
      },
      () => {}, // keep the cached copy; the next save retries the server
    );
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [userId]);

  useEffect(() => {
    if (userId) store.set(userKey(userId), stored);
  }, [stored, userId]);

  const save = useCallback(async () => {
    const doc = latest.current;
    setSaveState("saving");
    try {
      await call<View>("PUT", "/api/me/preferences", doc);
      // a newer change may be waiting in the timer; it reports its own state
      if (latest.current === doc) setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const commit = useCallback((next: StoredPreferences, pushUndo: boolean) => {
    if (pushUndo) {
      undoStack.current = [...undoStack.current, latest.current].slice(-UNDO_LIMIT);
      setUndoDepth(undoStack.current.length);
    }
    latest.current = next;
    setStored(next);
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, SAVE_DELAY_MS);
  }, [save]);

  const update = useCallback((fn: (s: StoredPreferences) => StoredPreferences) => commit(fn(latest.current), true), [commit]);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (prev) commit(prev, false);
  }, [commit]);
  const reset = useCallback(() => commit({}, true), [commit]);
  const retry = useCallback(() => void save(), [save]);

  const value = useMemo<PrefsCtx>(
    () => ({ prefs, update, undo, canUndo: undoDepth > 0, reset, saveState, retry }),
    [prefs, update, undo, undoDepth, reset, saveState, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePreferences outside PreferencesProvider");
  return v;
}
