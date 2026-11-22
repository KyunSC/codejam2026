import Link from "next/link";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { login } from "../actions";
import { btn, input } from "@/components/ui";

const ROLE_LABEL: Record<string, string> = {
  employee: "Employee", ap_clerk: "AP clerk", approver: "Approver", finance_manager: "Finance manager", controller_admin: "Controller / admin", auditor: "Auditor",
};

export default async function LoginPage() {
  const users = await query<{ email: string; full_name: string; role: string; title: string }>(
    "SELECT email, full_name, role, title FROM users WHERE role<>'brim_employee' AND status<>'terminated' ORDER BY role, full_name",
  );
  const byRole = Object.keys(ROLE_LABEL).map((r) => [r, users.filter((u) => u.role === r)] as const);
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm muted hover:underline">← brim</Link>
      <h1 className="mt-4 text-2xl font-semibold">Log in</h1>
      <ActionForm action={login} className="mt-6 flex max-w-md gap-2">
        <input name="email" type="email" required placeholder="you@company.com" className={input} />
        <button className={btn}>Log in</button>
      </ActionForm>
      <p className="mt-8 text-sm muted">Demo accounts (no password):</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {byRole.map(([role, list]) => list.length > 0 && (
          <div key={role} className="card p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{ROLE_LABEL[role]}</h2>
            <ul className="space-y-1">
              {list.slice(0, 6).map((u) => (
                <li key={u.email}>
                  <ActionForm action={login}>
                    <input type="hidden" name="email" value={u.email} />
                    <button className="text-left text-sm link">{u.full_name}</button>
                    <span className="ml-2 text-xs muted">{u.title}</span>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
