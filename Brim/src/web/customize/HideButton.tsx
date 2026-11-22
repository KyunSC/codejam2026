import { useEditMode } from "./EditMode";

// × on a tab, tile, card, section or column heading, in edit mode only.
export function HideButton({ label, onHide }: { label: string; onHide: () => void }) {
  const { editing } = useEditMode();
  if (!editing) return null;
  return (
    <button type="button" className="x-btn" aria-label={`Hide ${label}`} title="Hide" onClick={onHide}>
      ×
    </button>
  );
}
