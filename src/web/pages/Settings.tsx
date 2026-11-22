import { can } from "@/lib/authz";
import type { User } from "@/lib/types";
import { del, get, patch, post, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm, numOrNull, str } from "../components/ApiForm";
import { Card, Field, NotFound, Show, Status, Table, Td, btn, btnDanger, btnLight, dateTime, input } from "../components/ui";

const ROLES = ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"];

export function UsersSettings() {
  const user = useUser();
  const load = useLoad(async () => {
    const [users, depts] = await Promise.all([get<User[]>(org(user, "/users")), get<{ department_id: string; name: string }[]>(org(user, "/departments"))]);
    return { users, depts };
  }, "");
  if (!can(user, "users.manage")) return <NotFound />;

  const save = async (fd: FormData) => {
    const input = {
      full_name: str(fd, "full_name") ?? "",
      email: str(fd, "email") ?? "",
      title: str(fd, "title"),
      department_id: str(fd, "department_id"),
      manager_id: str(fd, "manager_id"),
      role: str(fd, "role") ?? "employee",
      approval_limit_cad: Number(str(fd, "approval_limit_cad") ?? 0),
      work_province: str(fd, "work_province"),
      status: str(fd, "status") ?? "active",
      delegate_user_id: str(fd, "delegate_user_id"),
      ...(str(fd, "password") ? { password: str(fd, "password") } : {}),
    };
    const id = str(fd, "user_id");
    if (id) await patch(org(user, `/users/${id}`), input);
    else await post(org(user, "/users"), input);
    load.reload();
    return "Saved.";
  };
  const remove = (userId: string) => async () => {
    await del(org(user, `/users/${userId}`));
    load.reload();
    return "Removed.";
  };

  return (
    <Show load={load}>
      {({ users, depts }) => {
        const active = users.filter((u) => u.status !== "terminated");
        const form = (u: Partial<User>) => (
          <ApiForm submit={save} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {u.user_id && <input type="hidden" name="user_id" value={u.user_id} />}
            <Field label="Name"><input name="full_name" defaultValue={u.full_name} className={input} required /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={u.email} className={input} required /></Field>
            <Field label="Title"><input name="title" defaultValue={u.title ?? ""} className={input} /></Field>
            <Field label="Role"><select name="role" defaultValue={u.role ?? "employee"} className={input}>{ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</select></Field>
            <Field label="Department"><select name="department_id" defaultValue={u.department_id ?? ""} className={input}><option value="">—</option>{depts.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}</select></Field>
            <Field label="Manager"><select name="manager_id" defaultValue={u.manager_id ?? ""} className={input}><option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></Field>
            <Field label="Approval limit (CAD)"><input name="approval_limit_cad" type="number" defaultValue={u.approval_limit_cad ?? 0} className={input} /></Field>
            <Field label="Province"><input name="work_province" defaultValue={u.work_province ?? ""} className={input} /></Field>
            <Field label="Status"><select name="status" defaultValue={u.status ?? "active"} className={input}><option>active</option><option>on_leave</option></select></Field>
            <Field label={u.user_id ? "New password" : "Password"}>
              <input name="password" type="password" minLength={8} required={!u.user_id} placeholder={u.user_id ? "unchanged" : ""} autoComplete="new-password" className={input} />
            </Field>
            <Field label="Delegate"><select name="delegate_user_id" defaultValue={u.delegate_user_id ?? ""} className={input}><option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></Field>
            <div className="col-span-2 sm:col-span-5"><button className={u.user_id ? btnLight : btn}>{u.user_id ? "Save" : "Add user"}</button></div>
          </ApiForm>
        );
        return (
          <div className="space-y-5">
            <Card title="Add a user">{form({})}</Card>
            <Card title={`${active.length} users`}>
              <ul className="divide-y divide-line">
                {users.map((u) => (
                  <li key={u.user_id} className="py-3">
                    <details>
                      <summary className="flex cursor-pointer items-center gap-3 text-sm">
                        <span className="w-16 font-mono text-xs muted">{u.user_id}</span>
                        <span className="w-48 font-medium">{u.full_name}</span>
                        <span className="w-56 muted">{u.title}</span>
                        <span className="w-36">{u.role.replace("_", " ")}</span>
                        <Status value={u.status} />
                      </summary>
                      {u.status !== "terminated" && (
                        <div className="mt-3 space-y-2 pl-16">
                          {form(u)}
                          {u.user_id !== user.user_id && <ApiForm submit={remove(u.user_id)}><button className={btnDanger}>Remove user</button></ApiForm>}
                        </div>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        );
      }}
    </Show>
  );
}

// Roles a step can be given to; the other step values (manager, delegate, not approver, hold) are fixed by their rule.
const APPROVER_ROLES = ["dept_manager", "finance_manager", "controller", "cfo"];
const RELEASE_ROLES = ["finance_manager", "controller_admin"];
const label = (s: string | null) => (s ?? "").replace(/_/g, " ");
type Policy = { rule_id: string; rule_type: string; trigger_type: string; trigger_value: number | null; step_role: string | null; is_active: boolean; updated_at: string; updater: string | null };

export function PoliciesSettings() {
  const user = useUser();
  const load = useLoad(() => get<Policy[]>(org(user, "/policies")), "");
  if (!can(user, "policies.manage")) return <NotFound />;
  const save = (ruleId: string) => async (fd: FormData) => {
    const body: Record<string, unknown> = { step_role: str(fd, "step_role"), is_active: fd.get("is_active") === "on" };
    if (fd.has("trigger_value")) body.trigger_value = numOrNull(fd, "trigger_value");
    await patch(org(user, `/policies/${ruleId}`), body);
    load.reload();
    return "Saved.";
  };
  return (
    <Card title="Approval and payment policies">
      <Show load={load}>
        {(rows) => (
          <Table head={["Rule", "Type", "Amount (CAD)", "Who", "Active", "Last change", ""]}>
            {rows.map((p) => {
              const form = `policy-${p.rule_id}`;
              const roles = p.rule_type === "payment_release" ? RELEASE_ROLES : APPROVER_ROLES;
              return (
                <tr key={p.rule_id}>
                  <Td className="font-mono text-xs align-middle">{p.rule_id}</Td>
                  <Td className="align-middle">{label(p.rule_type)}</Td>
                  <Td className="align-middle">
                    {p.trigger_value == null ? <span className="muted">—</span> : <input form={form} name="trigger_value" type="number" defaultValue={p.trigger_value} className={`${input} w-28`} />}
                  </Td>
                  <Td className="align-middle">
                    {p.step_role && roles.includes(p.step_role) ? (
                      <select form={form} name="step_role" defaultValue={p.step_role} className={`${input} w-40`}>
                        {roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>
                    ) : (
                      <>
                        <span>{label(p.step_role)}</span>
                        <input form={form} type="hidden" name="step_role" value={p.step_role ?? ""} />
                      </>
                    )}
                  </Td>
                  <Td className="align-middle"><input form={form} type="checkbox" name="is_active" defaultChecked={p.is_active} className="size-4" /></Td>
                  <Td className="muted text-xs align-middle">{p.updater ? `${p.updater}, ${dateTime(p.updated_at)}` : "—"}</Td>
                  <Td className="align-middle">
                    <ApiForm id={form} submit={save(p.rule_id)}>
                      <button className={btnLight}>Save</button>
                    </ApiForm>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Show>
    </Card>
  );
}
