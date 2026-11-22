import { useEditMode } from "./EditMode";

// "Hidden tabs: + Vendors + Audit" under an area, in edit mode only, when something there is hidden.
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
    <div className={`tray ${className}`} role="group" aria-label={`Hidden ${what}`}>
      <span className="tray__label">Hidden {what}</span>
      {hidden.map((i) => (
        <button key={i.id} type="button" className="chip tray__add" onClick={() => onShow(i.id)} aria-label={`Show ${i.label}`}>
          + {i.label}
        </button>
      ))}
    </div>
  );
}
