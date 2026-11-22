import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Status, btn, btnDanger, btnLight, input } from "@/components/ui";
import { removeUserAction, saveUserAction } from "../../../actions";
import type { User } from "@/lib/types";

const ROLES = ["employee", "ap_clerk", "approver", "finance_manager", "controller_admin", "auditor"];

export default async function UsersSettings() {
  const user = await requireUser();
  if (!can(user, "users.manage")) notFound();
  const users = await query<User>("SELECT * FROM users WHERE organization_id=$1 ORDER BY status='terminated', full_name", [user.organization_id]);
  const depts = await query<{ department_id: string; name: string }>("SELECT department_id, name FROM departments WHERE organization_id=$1 ORDER BY name", [user.organization_id]);
  const active = users.filter((u) => u.status !== "terminated");

  const form = (u: Partial<User>) => (
    <ActionForm action={saveUserAction} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
      <Field label="Delegate"><select name="delegate_user_id" defaultValue={u.delegate_user_id ?? ""} className={input}><option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></Field>
      <div className="col-span-2 sm:col-span-5"><button className={u.user_id ? btnLight : btn}>{u.user_id ? "Save" : "Add user"}</button></div>
    </ActionForm>
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
                    {u.user_id !== user.user_id && <ActionForm action={removeUserAction.bind(null, u.user_id)}><button className={btnDanger}>Remove user</button></ActionForm>}
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
