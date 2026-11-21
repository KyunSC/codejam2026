"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

export function StaffLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await send<{ redirect: string }>("POST", "/api/admin/session", Object.fromEntries(new FormData(e.currentTarget)));
      router.push(res.redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Brim email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn btn--solid self-start" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </Card>
  );
}
