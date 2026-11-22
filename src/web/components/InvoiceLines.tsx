import { useReducer } from "react";
import type { InvoiceLine } from "@/lib/types";
import { money } from "@/lib/format";
import { Table, Td, btnLight, input } from "./ui";

type LineProps = {
  lines: InvoiceLine[];
  gls: { account_number: string; name: string }[];
  depts: { department_id: string; name: string }[];
  currency: string;
};

type DepartmentDraft = { saved: InvoiceLine[]; lines: InvoiceLine[] } | null;
type DepartmentEdit = { type: "discard" } | { type: "assign"; saved: InvoiceLine[]; lineNo: number; id: string };

function editDepartments(draft: DepartmentDraft, edit: DepartmentEdit): DepartmentDraft {
  if (edit.type === "discard") return null;
  const lines = draft?.saved === edit.saved ? draft.lines : edit.saved;
  return {
    saved: edit.saved,
    lines: lines.map((line) => line.line_no === edit.lineNo ? { ...line, department_id: edit.id || null } : line),
  };
}

export function EditableLinesTable(props: LineProps) {
  const [draft, dispatch] = useReducer(editDepartments, null);
  const currentDraft = draft?.saved === props.lines ? draft : null;
  return (
    <>
      <LinesTable {...props} lines={currentDraft?.lines ?? props.lines}
        onAssign={(lineNo, id) => dispatch({ type: "assign", saved: props.lines, lineNo, id })} />
      {currentDraft && <button className={btnLight} type="button" onClick={() => dispatch({ type: "discard" })}>Discard department edits</button>}
    </>
  );
}

export function LinesTable({ lines, gls, depts, currency, onAssign }: LineProps & {
  onAssign?: (lineNo: number, departmentId: string) => void;
}) {
  return (
    <>
      <Table head={["#", "Description", "Qty", "Unit", "Amount", "GL account", "Department", "Type"]}>
        {lines.map((l) => (
          <tr key={l.line_no}>
            <Td>{l.line_no}</Td>
            <Td>
              {l.description}
              {l.suggestion_reason && <div className="text-xs muted">Suggested: {l.suggested_gl_account ?? "—"} · {l.suggestion_reason}{l.coding_status && l.coding_status !== "suggested" && ` · ${l.coding_status}`}</div>}
            </Td>
            <Td>{l.quantity}</Td>
            <Td className="whitespace-nowrap">{money(l.unit_price, currency)}</Td>
            <Td className="whitespace-nowrap">{money(l.amount, currency)}</Td>
            <Td>
              {onAssign ? (
                <select name={`gl_${l.line_no}`} defaultValue={l.gl_account ?? ""} className={input}>
                  <option value="">—</option>
                  {gls.map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
                </select>
              ) : `${l.gl_account ?? "—"} ${gls.find((g) => g.account_number === l.gl_account)?.name ?? ""}`}
            </Td>
            <Td>
              {onAssign ? (
                <select name={`dept_${l.line_no}`} aria-label={`Department for line ${l.line_no}`} value={l.department_id ?? ""}
                  onChange={(event) => onAssign(l.line_no, event.target.value)} className={input}>
                  <option value="">—</option>
                  {depts.map((x) => <option key={x.department_id} value={x.department_id}>{x.name}</option>)}
                </select>
              ) : depts.find((x) => x.department_id === l.department_id)?.name ?? "—"}
            </Td>
            <Td>
              {onAssign ? (
                <select name={`type_${l.line_no}`} defaultValue={l.line_type ?? "services"} className={input}>
                  <option>services</option><option>goods</option>
                </select>
              ) : l.line_type}
            </Td>
          </tr>
        ))}
      </Table>
      <DepartmentSplit lines={lines} depts={depts} currency={currency} />
    </>
  );
}

function DepartmentSplit({ lines, depts, currency }: Pick<LineProps, "lines" | "depts" | "currency">) {
  const groups = new Map<string | null, { amount: number; count: number }>();
  const decimal = new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false,
  });
  let subtotal = 0;
  for (const line of lines) {
    const id = line.department_id || null;
    const group = groups.get(id) ?? { amount: 0, count: 0 };
    // Round each CAD/USD line as displayed, then sum integer cents.
    const cents = Number(decimal.format(line.amount).replace(".", ""));
    group.amount += cents;
    group.count++;
    groups.set(id, group);
    subtotal += cents;
  }
  const format = new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" });
  return (
    <section className="space-y-2 text-sm" aria-label="Department split">
      <h3 className="font-medium">Department split</h3>
      <dl className="space-y-1">
        {Array.from(groups, ([id, { amount, count }]) => (
          <div key={id ?? ""} className="flex justify-between gap-3">
            <dt>{id ? depts.find((dept) => dept.department_id === id)?.name ?? id : "Unassigned"} · {count} {count === 1 ? "line" : "lines"}</dt>
            <dd className="tabular-nums">{format.format(amount / 100)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
          <dt>Line subtotal</dt><dd className="tabular-nums">{format.format(subtotal / 100)}</dd>
        </div>
      </dl>
    </section>
  );
}
