import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { ApiError, get } from "./api";

type Session = { user: User | null; loading: boolean; refresh: () => Promise<User | null> };

// The user of the session cookie, or null when signed out.
const signedIn = () =>
  get<User>("/api/session").catch((e) => {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  });

const SessionContext = createContext<Session>({ user: null, loading: true, refresh: async () => null });

// The signed-in user, from GET /api/session.
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const done = (u: User | null) => {
    setUser(u);
    setLoading(false);
    return u;
  };
  const refresh = useCallback(async () => done(await signedIn()), []);
  useEffect(() => {
    signedIn().then(done);
  }, []);
  return <SessionContext.Provider value={{ user, loading, refresh }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

// Inside the signed-in layouts the user is always there.
export function useUser() {
  return useContext(SessionContext).user!;
}

// The API path of the signed-in user's organization: org(user, "/invoices") → /api/organizations/ORG-…/invoices.
export const org = (user: User, path = "") => `/api/organizations/${user.organization_id}${path}`;
