import { useLocation } from "react-router-dom";
import type { PageId } from "@/lib/preferences";
import { usePreferences } from "../preferences";
import { useEditMode } from "./EditMode";
import { WorkspaceOptions } from "./WorkspaceOptions";

type PageInfo = { id: PageId | null; label: string; hint: string };

const NOTHING = "Nothing on this page can be customized.";
const TABLE_HINT = "Drag a column heading to move it, and press × to hide it. ☆ picks the filter the table opens on.";

// Which customizable page a route is, and what can change on it. Detail pages and forms have nothing to customize.
export function pageFor(pathname: string): PageInfo {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/dashboard") return { id: "dashboard", label: "Dashboard", hint: "Drag tiles and cards to move them, and press × to hide one." };
  if (p === "/invoices") return { id: "invoices", label: "Invoices", hint: `Drag a section by its header to move it. ${TABLE_HINT} Rows per page sit under each table.` };
  if (p === "/payments") return { id: "payments", label: "Payments", hint: `Press × to hide Ready to pay. ${TABLE_HINT}` };
  if (p === "/vendors") return { id: "vendors", label: "Vendors", hint: TABLE_HINT };
  if (p === "/settings/audit") return { id: "audit", label: "Audit", hint: "Drag a column heading to move it, and press × to hide it. Rows per page sit under the table." };
  if (p.startsWith("/organizations")) return { id: null, label: "Brim operations", hint: "Only the appearance can be changed here." };
  if (p.startsWith("/settings")) return { id: null, label: "Settings", hint: NOTHING };
  if (p === "/account") return { id: null, label: "Account", hint: NOTHING };
  if (p.startsWith("/invoices/")) return { id: null, label: "this invoice page", hint: NOTHING };
  if (p.startsWith("/payments/")) return { id: null, label: "this payment", hint: NOTHING };
  if (p.startsWith("/vendors/")) return { id: null, label: "this vendor page", hint: NOTHING };
  return { id: null, label: "this page", hint: NOTHING };
}

const SAVE_TEXT = { idle: "Changes save as you make them", saving: "Saving…", saved: "Saved", error: "Couldn't save." };

// The bar under the tabs while customizing: what can change here, Workspace options, Undo, Reset this page, Done.
export function EditBar({ workspace }: { workspace: boolean }) {
  const { editing, setEditing, optionsOpen, setOptionsOpen } = useEditMode();
  const { undo, canUndo, resetPage, saveState, retry } = usePreferences();
  const { pathname } = useLocation();
  if (!editing) return null;
  const page = pageFor(pathname);
  const tabsHint = workspace ? " You can also drag tabs to reorder them, and press × to hide one." : "";
  return (
    <div className="edit-bar" role="region" aria-label="Customizing">
      <div className="edit-bar__row">
        <div className="edit-bar__text">
          <strong>Customizing {page.label}</strong>
          <span className="muted">{page.hint}{tabsHint}</span>
        </div>
        <span className="edit-bar__save muted" aria-live="polite">
          {SAVE_TEXT[saveState]}
          {saveState === "error" && <> <button type="button" className="link" onClick={retry}>Retry</button></>}
        </span>
        <div className="edit-bar__actions">
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>Workspace options</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={undo} disabled={!canUndo}>Undo</button>
          {page.id && <button type="button" className="btn btn--ghost btn--sm" onClick={() => resetPage(page.id!)}>Reset this page</button>}
          <button type="button" className="btn btn--solid btn--sm" onClick={() => setEditing(false)}>Done</button>
        </div>
      </div>
      {optionsOpen && <WorkspaceOptions startPage={workspace} />}
    </div>
  );
}
