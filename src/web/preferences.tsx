import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resetPage as resetPageDoc, resolvePreferences, sanitizePreferences, type PageId, type ResolvedPreferences, type StoredPreferences } from "@/lib/preferences";
import { call } from "./api";
import { useSession } from "./session";
import type { User } from "@/lib/types";

// The signed-in user's workspace preferences, from /api/me/preferences.
// Changes apply at once (resolved locally with the same code the server uses) and are saved after a short pause.
// The last resolved appearance is cached in localStorage so index.html can apply it before the app loads.

type View = { stored: StoredPreferences; resolved: ResolvedPreferences };
export type SaveState = "idle" | "saving" | "saved" | "error";

type PrefsCtx = {
  prefs: ResolvedPreferences; // always complete: the defaults until loaded
  stored: StoredPreferences;
  loading: boolean;
  update: (fn: (s: StoredPreferences) => StoredPreferences) => void;
  undo: () => void;
  canUndo: boolean;
  resetPage: (page: PageId) => void;
  resetAll: () => Promise<void>;
  saveState: SaveState;
  retry: () => void;
};

const SAVE_DELAY_MS = 400;
const UNDO_LIMIT = 60;
const LAST_KEY = "brim:prefs:last"; // appearance of the last signed-in user, read by index.html
const userKey = (id: string) => `brim:prefs:${id}`;
// The cached copy for a user, cleaned like a stored document (it may predate the current shape).
const cachedFor = (id: string): StoredPreferences => sanitizePreferences(store.get(userKey(id)));

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
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // as above
    }
  },
};

// Appearance on <html>: index.html's script sets the same attributes before the first paint.
function applyAppearance(p: Pick<ResolvedPreferences, "theme" | "density" | "accent" | "textSize">) {
  const d = document.documentElement;
  if (p.theme === "system") d.removeAttribute("data-theme");
  else d.setAttribute("data-theme", p.theme);
  d.setAttribute("data-density", p.density);
  d.setAttribute("data-accent", p.accent);
  d.setAttribute("data-text-size", p.textSize);
}

const Ctx = createContext<PrefsCtx | null>(null);

// One provider per signed-in user (keyed by user id), so signing in as someone else starts from fresh state:
// their cached copy, an empty undo stack, nothing waiting to save.
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  return <UserPreferences key={user?.user_id ?? "signed-out"} user={user}>{children}</UserPreferences>;
}

function UserPreferences({ user, children }: { user: User | null; children: React.ReactNode }) {
  const userId = user?.user_id ?? null;
  const [stored, setStored] = useState<StoredPreferences>(() => (userId ? cachedFor(userId) : {}));
  const [loading, setLoading] = useState(!!userId);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [undoDepth, setUndoDepth] = useState(0);
  const latest = useRef<StoredPreferences>(stored);
  const undoStack = useRef<StoredPreferences[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefs = useMemo(() => resolvePreferences(stored, user), [stored, user]);

  // The server copy for a signed-in user; when signed out, forget the last user's appearance.
  useEffect(() => {
    if (!userId) {
      store.remove(LAST_KEY);
      return;
    }
    let live = true;
    call<View>("GET", "/api/me/preferences").then(
      (v) => {
        if (!live) return;
        latest.current = v.stored;
        setStored(v.stored);
        setLoading(false);
      },
      () => live && setLoading(false), // keep the cached copy; the next save retries the server
    );
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [userId]);

  // Appearance follows the resolved preferences; the cache follows what is stored.
  useEffect(() => {
    applyAppearance(prefs);
    if (userId) {
      store.set(userKey(userId), stored);
      store.set(LAST_KEY, { theme: prefs.theme, density: prefs.density, accent: prefs.accent, textSize: prefs.textSize });
    }
  }, [prefs, stored, userId]);

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

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, SAVE_DELAY_MS);
  }, [save]);

  const commit = useCallback((next: StoredPreferences, pushUndo: boolean) => {
    if (pushUndo) {
      undoStack.current = [...undoStack.current, latest.current].slice(-UNDO_LIMIT);
      setUndoDepth(undoStack.current.length);
    }
    latest.current = next;
    setStored(next);
    schedule();
  }, [schedule]);

  const update = useCallback((fn: (s: StoredPreferences) => StoredPreferences) => commit(fn(latest.current), true), [commit]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (prev) commit(prev, false);
  }, [commit]);

  const resetPage = useCallback((page: PageId) => commit(resetPageDoc(latest.current, page), true), [commit]);

  const resetAll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    undoStack.current = [...undoStack.current, latest.current].slice(-UNDO_LIMIT);
    setUndoDepth(undoStack.current.length);
    latest.current = {};
    setStored({});
    setSaveState("saving");
    try {
      await call<View>("DELETE", "/api/me/preferences");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const retry = useCallback(() => void save(), [save]);

  const value = useMemo<PrefsCtx>(
    () => ({ prefs, stored, loading, update, undo, canUndo: undoDepth > 0, resetPage, resetAll, saveState, retry }),
    [prefs, stored, loading, update, undo, undoDepth, resetPage, resetAll, saveState, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PrefsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePreferences outside PreferencesProvider");
  return v;
}
