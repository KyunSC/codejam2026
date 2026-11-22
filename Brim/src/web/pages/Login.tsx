import { Link, useNavigate } from "react-router-dom";
import { post, get, useLoad } from "../api";
import { useSession } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { btn, input } from "../components/ui";

const ROLE_LABEL: Record<string, string> = {
  employee: "Employee", ap_clerk: "AP clerk", approver: "Approver", finance_manager: "Finance manager", controller_admin: "Controller / admin", auditor: "Auditor",
};

// Signs in through POST /api/session, then opens the portal's first screen.
function useLogin(portal: "organization" | "brim") {
  const { refresh } = useSession();
  const navigate = useNavigate();
  return async (fd: FormData) => {
    await post("/api/session", { email: str(fd, "email") ?? "", portal });
    await refresh();
    navigate(portal === "brim" ? "/organizations" : "/dashboard");
  };
}

export function Login() {
  const login = useLogin("organization");
  const accounts = useLoad(() => get<{ email: string; full_name: string; role: string; title: string }[]>("/api/session/demo-accounts"), "");
  const users = accounts.data ?? [];
  const byRole = Object.keys(ROLE_LABEL).map((r) => [r, users.filter((u) => u.role === r)] as const);
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/" className="text-sm muted hover:underline">← brim</Link>
      <h1 className="mt-4 text-2xl font-semibold">Log in</h1>
      <ApiForm submit={login} className="mt-6 flex max-w-md gap-2">
        <input name="email" type="email" required placeholder="you@company.com" className={input} />
        <button className={btn}>Log in</button>
      </ApiForm>
      <p className="mt-8 text-sm muted">Demo accounts (no password):</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {byRole.map(([role, list]) => list.length > 0 && (
          <div key={role} className="card p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{ROLE_LABEL[role]}</h2>
            <ul className="space-y-1">
              {list.slice(0, 6).map((u) => (
                <li key={u.email}>
                  <ApiForm submit={login}>
                    <input type="hidden" name="email" value={u.email} />
                    <button className="text-left text-sm link">{u.full_name}</button>
                    <span className="ml-2 text-xs muted">{u.title}</span>
                  </ApiForm>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmployeeLogin() {
  const login = useLogin("brim");
  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Link to="/" className="text-sm muted hover:underline">← brim</Link>
      <h1 className="mt-4 text-2xl font-semibold">Brim employee login</h1>
      <ApiForm submit={login} className="mt-6 space-y-3">
        <input name="email" type="email" required defaultValue="ops@brim.example" className={input} />
        <button className={btn}>Log in</button>
      </ApiForm>
    </div>
  );
}
