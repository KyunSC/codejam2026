import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TABS, type ResolvedPreferences } from "@/lib/preferences";
import { post, get, useLoad } from "../api";
import { useSession } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { btn, input } from "../components/ui";

const ROLE_LABEL: Record<string, string> = {
  brim_employee: "Brim employee", employee: "Employee", ap_clerk: "AP clerk", approver: "Approver", finance_manager: "Finance manager", controller_admin: "Controller / admin", auditor: "Auditor",
};

// Where an organization user starts: the start page from their workspace preferences, else the dashboard.
async function startPage() {
  try {
    const { resolved } = await get<{ resolved: ResolvedPreferences }>("/api/me/preferences");
    return TABS.find((t) => t.id === resolved.landingPage)?.href ?? "/dashboard";
  } catch {
    return "/dashboard";
  }
}

// Signs in through POST /api/session, then opens the portal's first screen.
function useLogin(portal: "organization" | "brim") {
  const { refresh } = useSession();
  const navigate = useNavigate();
  return async (fd: FormData) => {
    await post("/api/session", { email: str(fd, "email") ?? "", password: str(fd, "password") ?? "", portal });
    await refresh();
    navigate(portal === "brim" ? "/organizations" : await startPage());
  };
}

// The listed accounts of one login; clicking one signs in as it.
function DemoAccounts({ portal }: { portal: "organization" | "brim" }) {
  const accounts = useLoad(() => get<{ email: string; full_name: string; role: string; title: string }[]>(`/api/session/demo-accounts?portal=${portal}`), portal);
  const users = accounts.data ?? [];
  const byRole = Object.keys(ROLE_LABEL).map((r) => [r, users.filter((u) => u.role === r)] as const).filter(([, list]) => list.length > 0);
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const pick = async (address: string) => {
    try {
      await post("/api/session/demo", { email: address, portal });
      await refresh();
      navigate(portal === "brim" ? "/organizations" : await startPage());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!byRole.length) return null;
  return (
    <>
      <p className="mt-8 text-sm muted">Demo accounts:</p>
      {error && <p className="form-error mt-2">{error}</p>}
      <div className={`mt-3 grid gap-4 ${byRole.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {byRole.map(([role, list]) => (
          <div key={role} className="card p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{ROLE_LABEL[role]}</h2>
            <ul className="space-y-1">
              {list.slice(0, 6).map((u) => (
                <li key={u.email}>
                  <button type="button" className="text-left text-sm link" onClick={() => pick(u.email)}>{u.full_name}</button>
                  <span className="ml-2 text-xs muted">{u.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

export function Login() {
  const login = useLogin("organization");
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/" className="text-sm muted hover:underline">← brim</Link>
      <h1 className="mt-4 text-2xl font-semibold">Log in</h1>
      <ApiForm submit={login} className="mt-6 max-w-xl">
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <input name="email" type="email" required placeholder="you@company.com" autoComplete="username" className={input} />
          <input name="password" type="password" required placeholder="Password" autoComplete="current-password" className={input} />
          <button className={btn}>Log in</button>
        </div>
      </ApiForm>
      <DemoAccounts portal="organization" />
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
        <input name="email" type="email" required defaultValue="ops@brim.example" autoComplete="username" className={input} />
        <input name="password" type="password" required placeholder="Password" autoComplete="current-password" className={input} />
        <button className={btn}>Log in</button>
      </ApiForm>
      <DemoAccounts portal="brim" />
    </div>
  );
}
