import { useEditMode } from "./EditMode";

// The palette under an area, in edit mode only: "Add tiles: + Overdue invoices + …", everything the user may add
// that isn't on the page. Each widget is on the page at most once, so what is on it is never offered again.
export function HiddenTray({ what, items, onShow, className = "" }: {
  what: string; // "tabs", "tiles", "columns" …
  items: { id: string; label: string; visible: boolean }[];
  onShow: (id: string) => void;
  className?: string;
}) {
  const { editing } = useEditMode();
  const hidden = items.filter((i) => !i.visible);
  if (!editing || !hidden.length) return null;
  return (
    <div className={`tray ${className}`} role="group" aria-label={`Add ${what}`}>
      <span className="tray__label">Add {what}</span>
      {hidden.map((i) => (
        <button key={i.id} type="button" className="chip tray__add" onClick={() => onShow(i.id)} aria-label={`Add ${i.label}`}>
          + {i.label}
        </button>
      ))}
    </div>
  );
}
