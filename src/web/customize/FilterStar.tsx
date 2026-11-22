import { useNavigate } from "react-router-dom";
import type { StoredPreferences, TableId } from "@/lib/preferences";
import { usePreferences } from "../preferences";
import { useEditMode } from "./EditMode";

// Save the filter a table opens on.
export const setFilter = (table: TableId, value: string) => (s: StoredPreferences): StoredPreferences => ({
  ...s,
  tables: { ...s.tables, [table]: { ...s.tables?.[table], filter: value } },
});

// ☆ next to a filter chip (or a Payments totals tile), in edit mode only. ★ marks the filter the table opens on.
// Clicking it makes that filter the default and shows it.
export function FilterStar({ table, value, label, to, className = "" }: { table: TableId; value: string; label: string; to: string; className?: string }) {
  const { editing } = useEditMode();
  const { prefs, update } = usePreferences();
  const navigate = useNavigate();
  if (!editing) return null;
  const on = prefs.tables[table].filter === value;
  return (
    <button
      type="button"
      className={`star ${className}`}
      aria-pressed={on}
      aria-label={on ? `${label} is the filter this table opens on` : `Open this table on ${label}`}
      title={on ? "Opens on this filter" : "Open on this filter"}
      onClick={() => {
        update(setFilter(table, value));
        navigate(to);
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
