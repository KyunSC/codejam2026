import { useNavigate, useSearchParams } from "react-router-dom";
import { tableDef, type StoredPreferences, type TableId } from "@/lib/preferences";
import { usePreferences } from "../preferences";
import { withParams } from "../components/ui";
import { useEditMode } from "./EditMode";

// Save how many rows a table shows per page.
export const setPageSize = (table: TableId, size: number) => (s: StoredPreferences): StoredPreferences => ({
  ...s,
  tables: { ...s.tables, [table]: { ...s.tables?.[table], pageSize: size } },
});

// "Rows per page: 5 10 20" under a paged table, in edit mode only. Changing it goes back to page 1
// (`param` is the table's page parameter in the URL).
export function RowsPerPage({ table, param }: { table: TableId; param: string }) {
  const { editing } = useEditMode();
  const { prefs, update } = usePreferences();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const sizes = tableDef(table).pageSizes;
  if (!editing || !sizes) return null;
  const id = `rows-${table}`;
  return (
    <div className="rows-per-page">
      <span id={id} className="label muted text-xs">Rows per page</span>
      <div className="seg" role="group" aria-labelledby={id}>
        {sizes.values.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={prefs.tables[table].pageSize === n}
            onClick={() => {
              update(setPageSize(table, n));
              if (sp.has(param)) navigate(withParams(sp, { [param]: null }), { replace: true });
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
