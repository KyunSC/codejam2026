"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client/api";

/** Logs out of the organization (or, with `staff`, out of Brim admin) and goes home. */
export function LogoutButton({ staff = false }: { staff?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logOut() {
    setBusy(true);
    try {
      if (staff) await send("DELETE", "/api/admin/session");
      else await send("POST", "/api/auth/logout");
    } finally {
      router.push("/");
      router.refresh();
    }
  }
  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={logOut} disabled={busy}>
      {staff ? "Log out of Brim admin" : "Log out"}
    </button>
  );
}
