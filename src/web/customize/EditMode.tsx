import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../preferences";

// Whether the dashboard is being customized. UI state only: it resets on reload, and only the changes made in it are saved.

type EditCtx = {
  editing: boolean;
  setEditing: (on: boolean) => void;
  setDragging: (on: boolean) => void; // a drag in progress owns Esc (it cancels the drag)
};

const Ctx = createContext<EditCtx>({ editing: false, setEditing: () => {}, setDragging: () => {} });

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const dragging = useRef(false);
  const setDragging = useCallback((on: boolean) => {
    // released after this keydown has been handled, so the Esc that cancels a drag doesn't also leave edit mode
    if (on) dragging.current = true;
    else setTimeout(() => (dragging.current = false), 0);
  }, []);

  // Esc leaves edit mode.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dragging.current && !e.defaultPrevented) setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const value = useMemo(() => ({ editing, setEditing, setDragging }), [editing, setDragging]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEditMode = () => useContext(Ctx);

// The button that turns edit mode on. In edit mode the edit bar's Done takes its place.
export function CustomizeButton() {
  const { editing, setEditing } = useEditMode();
  if (editing) return null;
  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      Customize
    </button>
  );
}

const SAVE_TEXT = { idle: "Changes save as you make them", saving: "Saving…", saved: "Saved", error: "Couldn't save." };

// The bar above the dashboard while customizing: how it works, Undo, Reset, Done.
export function EditBar() {
  const { editing, setEditing } = useEditMode();
  const { undo, canUndo, reset, saveState, retry } = usePreferences();
  if (!editing) return null;
  return (
    <div className="edit-bar" role="region" aria-label="Customizing">
      <div className="edit-bar__row">
        <div className="edit-bar__text">
          <strong>Customizing the dashboard</strong>
          <span className="muted">Drag tiles and cards to move them, and press × to hide one.</span>
        </div>
        <span className="edit-bar__save muted" aria-live="polite">
          {SAVE_TEXT[saveState]}
          {saveState === "error" && <> <button type="button" className="link" onClick={retry}>Retry</button></>}
        </span>
        <div className="edit-bar__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={undo} disabled={!canUndo}>Undo</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Reset</button>
          <button type="button" className="btn btn--solid btn--sm" onClick={() => setEditing(false)}>Done</button>
        </div>
      </div>
    </div>
  );
}
