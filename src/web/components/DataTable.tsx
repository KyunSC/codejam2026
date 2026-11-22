import type { TableId } from "@/lib/preferences";
import { usePreferences } from "../preferences";
import { useEditMode } from "../customize/EditMode";
import { SortableArea, SortableItem } from "../customize/Sortable";
import { HideButton } from "../customize/HideButton";
import { HiddenTray } from "../customize/HiddenTray";
import { reorder, setVisible } from "../customize/lists";
import { Table, Td } from "./ui";

// How one column renders a row. Its label and whether it's locked come from TABLES in src/lib/preferences.ts;
// `label` overrides the heading when a page words it differently (e.g. "Submission" for someone who only submits).
export type Column<Row> = { id: string; render: (row: Row) => React.ReactNode; className?: string; label?: string };

// A table whose columns the user can reorder and hide. Outside edit mode it renders exactly what <Table> renders.
// In edit mode the headings can be dragged (the first, locked column stays put) and hidden, with a tray to bring them back.
// `trailing` is an action column (Extract, Release…): always last, never customizable, with an empty heading.
export function DataTable<Row>({ table, rows, rowKey, rowClassName, columns, trailing, empty }: {
  table: TableId;
  rows: Row[];
  rowKey: (row: Row) => string;
  rowClassName?: (row: Row) => string | undefined;
  columns: Column<Row>[];
  trailing?: (row: Row) => React.ReactNode;
  empty?: string;
}) {
  const { editing } = useEditMode();
  const { prefs, update } = usePreferences();
  const byId = new Map(columns.map((c) => [c.id, c]));
  const resolved = prefs.tables[table].columns.filter((c) => byId.has(c.id)).map((c) => ({ ...c, label: byId.get(c.id)!.label ?? c.label }));
  const shown = resolved.filter((c) => c.visible);
  const body = rows.map((r) => (
    <tr key={rowKey(r)} className={rowClassName?.(r)}>
      {shown.map((c) => <Td key={c.id} className={byId.get(c.id)!.className}>{byId.get(c.id)!.render(r)}</Td>)}
      {trailing && <Td>{trailing(r)}</Td>}
    </tr>
  ));

  if (!editing) {
    return <Table head={[...shown.map((c) => c.label), ...(trailing ? [""] : [])]} empty={empty}>{body}</Table>;
  }

  const path = { kind: "columns", table } as const;
  const locked = shown.filter((c) => c.locked);
  const movable = shown.filter((c) => !c.locked);
  const hide = (id: string, label: string) => <HideButton label={`the ${label} column`} onHide={() => update(setVisible(path, prefs.tables[table].columns, id, false))} />;
  return (
    <>
      <div className="-mx-5 overflow-x-auto">
        <table className="tbl text-sm">
          <thead>
            <tr>
              {locked.map((c) => <th key={c.id}>{c.label}</th>)}
              <SortableArea
                ids={movable.map((c) => c.id)}
                labels={Object.fromEntries(resolved.map((c) => [c.id, `the ${c.label} column`]))}
                strategy="horizontal"
                onReorder={(ids) => update(reorder(path, prefs.tables[table].columns, [...locked.map((c) => c.id), ...ids]))}
              >
                {movable.map((c) => (
                  <SortableItem key={c.id} id={c.id} as="th" className="th-edit">
                    {({ grip }) => (
                      <span className="th-edit__in">
                        {grip}
                        {c.label}
                        {hide(c.id, c.label)}
                      </span>
                    )}
                  </SortableItem>
                ))}
              </SortableArea>
              {trailing && <th />}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        {rows.length === 0 && <p className="muted px-5 py-4 text-sm">{empty ?? "Nothing here."}</p>}
      </div>
      <HiddenTray what="columns" className="mt-3" items={resolved} onShow={(id) => update(setVisible(path, prefs.tables[table].columns, id, true))} />
    </>
  );
}
