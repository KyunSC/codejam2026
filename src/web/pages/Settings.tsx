import { useState } from "react";
import { Link } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import { FIELDS, POLICY_TYPES, REQUIREMENTS, operatorsFor, requiredLabels, type Operator, type Policy, type PolicyType } from "@/lib/policies";
import type { User } from "@/lib/types";
import { del, get, patch, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { useListFilter } from "../useListFilter";
import { ApiForm, numOrNull, str } from "../components/ApiForm";
import { Badge, Card, Field, NotFound, OptionalFields, PAGE_SIZE, Pager, Show, Status, Table, Td, btn, btnDanger, btnLight, dateTime, input, pageParam, withParams } from "../components/ui";

const ROLES = ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"];

const ROLE_LABEL: Record<string, string> = {
  employee: "Employee",
  ap_clerk: "AP clerk",
  approver: "Approver",
  finance_manager: "Finance manager",
  controller_admin: "Controller / admin",
  auditor: "Auditor",
};
const STATUSES = ["active", "on_leave", "terminated"];

export function UsersSettings() {
  const user = useUser();
  // the name search filters as you type (q in the URL); role and status are chips
  const { sp, search, draft, setDraft, term } = useListFilter();
  const page = pageParam(sp.get("page"));
  const role = ROLES.includes(sp.get("role") ?? "") ? sp.get("role") : null;
  const status = STATUSES.includes(sp.get("status") ?? "") ? sp.get("status") : null;
  // one page of users to show; everyone, for the manager and delegate pickers and the counts per role
  const load = useLoad(async () => {
    const [users, everyone, depts] = await Promise.all([
      get<(User & { total_count: number })[]>(org(user, `/users${qs({ q: search || null, role, status, page, size: PAGE_SIZE })}`)),
      get<User[]>(org(user, "/user-choices")),
      get<{ department_id: string; name: string }[]>(org(user, "/departments")),
    ]);
    return { users, everyone, depts };
  }, `${search}:${role}:${status}:${page}`);
  const busy = term !== search || !!load.stale;
  // "+ Add user" opens an empty row at the top of the list
  const [adding, setAdding] = useState(false);
  if (!can(user, "users.manage")) return <NotFound />;

  // one form per user: "Save" saves it, "Remove user" (its other button) removes the user
  const save = async (fd: FormData) => {
    const id = str(fd, "user_id");
    if (id && fd.get("intent") === "remove") {
      await del(org(user, `/users/${id}`));
      load.reload();
      return "Removed.";
    }
    const input = {
      full_name: str(fd, "full_name") ?? "",
      email: str(fd, "email") ?? "",
      title: str(fd, "title"),
      department_id: str(fd, "department_id"),
      manager_id: str(fd, "manager_id"),
      role: str(fd, "role") ?? "employee",
      approval_limit_cad: numOrNull(fd, "approval_limit_cad"),
      work_province: str(fd, "work_province"),
      status: str(fd, "status") ?? "active",
      delegate_user_id: str(fd, "delegate_user_id"),
      ...(str(fd, "password") ? { password: str(fd, "password") } : {}),
    };
    if (id) await patch(org(user, `/users/${id}`), input);
    else await post(org(user, "/users"), input);
    setAdding(false);
    load.reload();
    return "Saved.";
  };

  return (
    <Show load={load}>
      {({ users, everyone, depts }) => {
        const active = everyone.filter((u) => u.status !== "terminated");
        const form = (u: Partial<User>) => (
          <ApiForm submit={save} className="grid grid-cols-2 gap-2 sm:grid-cols-4" confirm={(fd) => (fd.get("intent") === "remove" ? `Remove ${u.full_name}? They can no longer sign in.` : null)}>
            {u.user_id && <input type="hidden" name="user_id" value={u.user_id} />}
            <Field label="Name"><input name="full_name" defaultValue={u.full_name} className={input} required /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={u.email} className={input} required /></Field>
            <Field label="Role"><select name="role" defaultValue={u.role ?? "employee"} className={input}>{ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</select></Field>
            <Field label={u.user_id ? "New password" : "Password"}>
              <input name="password" type="password" minLength={8} required={!u.user_id} placeholder={u.user_id ? "unchanged" : ""} autoComplete="new-password" className={input} />
            </Field>
            <OptionalFields className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Title"><input name="title" defaultValue={u.title ?? ""} className={input} /></Field>
            <Field label="Department"><select name="department_id" defaultValue={u.department_id ?? ""} className={input}><option value="">—</option>{depts.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}</select></Field>
            <Field label="Manager"><select name="manager_id" defaultValue={u.manager_id ?? ""} className={input}><option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></Field>
            <Field label="Approval limit (CAD)"><input name="approval_limit_cad" type="number" min="0" step="0.01" defaultValue={u.approval_limit_cad ?? ""} className={input} /></Field>
            <Field label="Province"><input name="work_province" defaultValue={u.work_province ?? ""} className={input} /></Field>
            <Field label="Status"><select name="status" defaultValue={u.status ?? "active"} className={input}><option>active</option><option>on_leave</option></select></Field>
            {/* a delegate covers someone already working here; a new user gets one later if they go on leave */}
            {u.user_id && <Field label="Delegate"><select name="delegate_user_id" defaultValue={u.delegate_user_id ?? ""} className={input}><option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></Field>}
            </OptionalFields>
            <div className="col-span-2 flex gap-2 sm:col-span-4">
              <button className={u.user_id ? btnLight : btn}>{u.user_id ? "Save" : "Add user"}</button>
              {u.user_id && u.user_id !== user.user_id && <button name="intent" value="remove" formNoValidate className={btnDanger}>Remove user</button>}
              {!u.user_id && <button type="button" className={btnLight} onClick={() => setAdding(false)}>Cancel</button>}
            </div>
          </ApiForm>
        );
        const perRole = (r: string | null) => everyone.filter((u) => (r === null || u.role === r) && (!status || u.status === status)).length;
        const filtered = !!(search || role || status);
        return (
          <div className="space-y-5">
            <Card title={`${users[0]?.total_count ?? 0} ${filtered ? "matching " : ""}users`} actions={!adding && <button className={btnLight} onClick={() => setAdding(true)}>+ Add user</button>}>
              <div className="mb-4 flex flex-col gap-3">
                <input
                  className="input max-w-md"
                  type="search"
                  aria-label="Search users"
                  placeholder="Search by name, email, title or ID"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-xs muted">Role</span>
                  {([null, ...ROLES] as (string | null)[]).map((r) => (
                    <Link key={r ?? "all"} to={withParams(sp, { role: r, q: term || null, page: null })} className="chip" aria-current={role === r}>
                      {r ? ROLE_LABEL[r] : "All"} ({perRole(r)})
                    </Link>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-xs muted">Status</span>
                  {([null, ...STATUSES] as (string | null)[]).map((s) => (
                    <Link key={s ?? "all"} to={withParams(sp, { status: s, q: term || null, page: null })} className="chip" aria-current={status === s}>
                      {s ? s.replace("_", " ") : "All"}
                    </Link>
                  ))}
                </div>
              </div>
              {!adding && users.length === 0 && <p className="m-0 py-3 text-sm muted">No users match. Change the search or the filters.</p>}
              <ul className={`divide-y divide-line ${busy ? "opacity-60 transition-opacity" : "transition-opacity"}`} aria-busy={busy}>
                {adding && (
                  <li className="py-3">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="w-16 font-mono text-xs muted">new</span>
                      <span className="font-medium">New user</span>
                    </div>
                    <div className="mt-3 space-y-2 pl-16">{form({})}</div>
                  </li>
                )}
                {users.map((u) => (
                  <li key={u.user_id} className="py-3">
                    <details>
                      <summary className="flex cursor-pointer items-center gap-3 text-sm">
                        <span className="w-16 font-mono text-xs muted">{u.user_id}</span>
                        <span className="w-48 font-medium">{u.full_name}</span>
                        <span className="w-56 muted">{u.title}</span>
                        <span className="w-36">{ROLE_LABEL[u.role] ?? u.role.replace("_", " ")}</span>
                        <Status value={u.status} />
                      </summary>
                      {u.status !== "terminated" && (
                        <div className="mt-3 space-y-2 pl-16">
                          {form(u)}
                        </div>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
              <Pager param="page" page={page} total={users[0]?.total_count ?? 0} />
            </Card>
          </div>
        );
      }}
    </Show>
  );
}

type PolicyRow = Policy & { updated_at?: string; updater?: string | null };
const TYPE_ORDER = Object.keys(POLICY_TYPES) as PolicyType[];
const firstField = (t: PolicyType) => Object.keys(FIELDS).find((k) => FIELDS[k].type === t)!;

// One table of policies: each row reads as what it is for, its condition and what it requires; Edit opens that row.
export function PoliciesSettings() {
  const user = useUser();
  // vendor category values come from the vendors on file
  const load = useLoad(async () => {
    const [rows, vendors] = await Promise.all([get<PolicyRow[]>(org(user, "/policies")), get<{ category: string | null }[]>(org(user, "/vendor-choices"))]);
    return { rows, categories: [...new Set(vendors.map((v) => v.category).filter((c): c is string => !!c))].sort() };
  }, "");
  const [editing, setEditing] = useState<string | null>(null);
  if (!can(user, "policies.manage")) return <NotFound />;
  const done = () => {
    setEditing(null);
    load.reload();
  };
  return (
    <Show load={load}>
      {({ rows, categories }) => (
        <Card title="Approval and payment policies" actions={editing !== "new" && <button className={btnLight} onClick={() => setEditing("new")}>+ Add policy</button>}>
          <Table head={["Rule", "For", "Field", "Operator", "Value", "Requires", "Status", ""]}>
            {editing === "new" && (
              <PolicyEditor policy={{ rule_id: "", rule_type: "approval", field: "invoice_total", operator: ">", value: null, required: [], is_active: true }} categories={categories} onDone={done} onCancel={() => setEditing(null)} />
            )}
            {[...rows].sort((a, b) => TYPE_ORDER.indexOf(a.rule_type) - TYPE_ORDER.indexOf(b.rule_type) || a.rule_id.localeCompare(b.rule_id)).map((r) =>
              editing === r.rule_id
                ? <PolicyEditor key={r.rule_id} policy={r} categories={categories} onDone={done} onCancel={() => setEditing(null)} />
                : <PolicyRowView key={r.rule_id} policy={r} onEdit={() => setEditing(r.rule_id)} />,
            )}
          </Table>
        </Card>
      )}
    </Show>
  );
}

function PolicyRowView({ policy: p, onEdit }: { policy: PolicyRow; onEdit: () => void }) {
  return (
    <tr className={p.is_active ? "" : "opacity-60"}>
      <Td className="font-mono text-xs">{p.rule_id}</Td>
      <Td className="whitespace-nowrap">{POLICY_TYPES[p.rule_type].label}</Td>
      <Td className="whitespace-nowrap">{FIELDS[p.field]?.label ?? p.field}</Td>
      <Td className="font-mono">{p.operator}</Td>
      <Td className="whitespace-nowrap">{p.value == null ? "" : FIELDS[p.field]?.kind === "amount" ? money(Number(p.value)) : p.value}</Td>
      <Td><span className="flex flex-wrap gap-1">{requiredLabels(p).map((l) => <Badge key={l}>{l}</Badge>)}</span></Td>
      <Td>
        <Badge tone={p.is_active ? "green" : "gray"}>{p.is_active ? "on" : "off"}</Badge>
        {p.updater && <div className="mt-1 text-xs muted">{p.updater}, {dateTime(p.updated_at)}</div>}
      </Td>
      <Td><button className={btnLight} onClick={onEdit}>Edit</button></Td>
    </tr>
  );
}

// The row opened for editing: the condition's parts, what it requires, and whether it is on.
function PolicyEditor({ policy, categories, onDone, onCancel }: { policy: PolicyRow; categories: string[]; onDone: () => void; onCancel: () => void }) {
  const user = useUser();
  const [type, setType] = useState<PolicyType>(policy.rule_type);
  const [field, setField] = useState(policy.field);
  const f = FIELDS[field];
  const ops = operatorsFor(field);
  const [operator, setOperator] = useState<Operator>(policy.operator ?? ops[0]);
  const [value, setValue] = useState(policy.value ?? "");
  const choices = field === "vendor_category" ? categories : FIELDS[field]?.choices ?? [];
  // a choice value is one value, or several joined by commas for "in"
  const picked = value.split(",").map((v) => v.trim()).filter((v) => choices.includes(v));
  const [required, setRequired] = useState<string[]>(policy.required);
  const [active, setActive] = useState(policy.is_active);
  const op = ops.includes(operator) ? operator : ops[0];
  const saved = f.kind === "amount" ? value : f.kind === "choice" ? (op === "is" ? picked.slice(0, 1) : picked).join(",") : null;
  // what a policy of this type may require
  const allowed = Object.keys(REQUIREMENTS).filter((r) => REQUIREMENTS[r].on.includes(POLICY_TYPES[type].on));

  const save = async () => {
    const body = { field, operator: op, value: saved || null, required: required.filter((r) => allowed.includes(r)), is_active: active };
    if (policy.rule_id) await patch(org(user, `/policies/${policy.rule_id}`), body);
    else await post(org(user, "/policies"), { rule_type: type, ...body });
    onDone();
  };

  const formId = `policy-${policy.rule_id || "new"}`;
  const sel = `${input} w-auto`;
  return (
    <tr className="bg-surface-2">
      <Td className="font-mono text-xs">{policy.rule_id || "new"}</Td>
      <Td>
        {policy.rule_id
          ? POLICY_TYPES[type].label
          : (
            <select value={type} onChange={(e) => { const k = e.target.value as PolicyType; setType(k); setField(firstField(k)); setValue(""); setRequired([]); }} className={sel} aria-label="For">
              {TYPE_ORDER.map((k) => <option key={k} value={k}>{POLICY_TYPES[k].label}</option>)}
            </select>
          )}
      </Td>
      <Td>
        <select value={field} onChange={(e) => { setField(e.target.value); setValue(""); }} className={sel} aria-label="Field">
          {Object.entries(FIELDS).filter(([, x]) => x.type === type).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
        </select>
      </Td>
      <Td>
        <select value={op} onChange={(e) => setOperator(e.target.value as Operator)} className={sel} aria-label="Operator" disabled={ops.length === 1}>
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Td>
      <Td>
        {f.kind === "amount" && (
          <input form={formId} type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} required className={`${input} w-36`} aria-label="Value" />
        )}
        {f.kind === "choice" && op === "is" && (
          <select form={formId} value={picked[0] ?? ""} onChange={(e) => setValue(e.target.value)} required className={`${input} w-auto`} aria-label="Value">
            <option value="" disabled>Pick</option>
            {choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {f.kind === "choice" && op === "in" && (
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {choices.map((c) => (
              <label key={c} className="flex items-center gap-2 whitespace-nowrap">
                <input type="checkbox" checked={picked.includes(c)} onChange={(e) => setValue((e.target.checked ? [...picked, c] : picked.filter((x) => x !== c)).join(","))} />
                {c}
              </label>
            ))}
          </div>
        )}
      </Td>
      <Td>
        <div className="space-y-1">
          {allowed.map((k) => (
            <label key={k} className="flex items-center gap-2 whitespace-nowrap">
              <input type="checkbox" checked={required.includes(k)} onChange={(e) => setRequired((r) => (e.target.checked ? [...r, k] : r.filter((x) => x !== k)))} />
              {REQUIREMENTS[k].label}
            </label>
          ))}
        </div>
      </Td>
      <Td>
        <label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> On</label>
      </Td>
      <Td>
        <ApiForm id={formId} submit={save} className="flex w-44 flex-wrap items-start gap-2">
          <button className={btn}>{policy.rule_id ? "Save" : "Add"}</button>
          <button type="button" className={btnLight} onClick={onCancel}>Cancel</button>
        </ApiForm>
      </Td>
    </tr>
  );
}
