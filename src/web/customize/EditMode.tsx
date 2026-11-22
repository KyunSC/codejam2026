import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Whether the workspace is in edit mode. UI state only: it resets on reload, and only the changes made in it are saved.
// Mounted in each layout, so it stays on while the user moves between pages.

type EditCtx = {
  editing: boolean;
  setEditing: (on: boolean) => void;
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean) => void;
  setDragging: (on: boolean) => void; // a drag in progress owns Esc (it cancels the drag)
};

const Ctx = createContext<EditCtx>({ editing: false, setEditing: () => {}, optionsOpen: false, setOptionsOpen: () => {}, setDragging: () => {} });

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditingState] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const dragging = useRef(false);

  const setEditing = useCallback((on: boolean) => {
    setEditingState(on);
    if (!on) setOptionsOpen(false);
  }, []);
  const setDragging = useCallback((on: boolean) => {
    // released after this keydown has been handled, so the Esc that cancels a drag doesn't also leave edit mode
    if (on) dragging.current = true;
    else setTimeout(() => (dragging.current = false), 0);
  }, []);

  // Esc closes Workspace options first, then leaves edit mode.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dragging.current || e.defaultPrevented) return;
      if (optionsOpen) setOptionsOpen(false);
      else setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, optionsOpen, setEditing]);

  const value = useMemo(() => ({ editing, setEditing, optionsOpen, setOptionsOpen, setDragging }), [editing, setEditing, optionsOpen, setDragging]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEditMode = () => useContext(Ctx);

// The header button that turns edit mode on. In edit mode the edit bar's Done takes its place.
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
