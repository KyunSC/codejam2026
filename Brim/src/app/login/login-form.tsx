"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await send<{ redirect: string }>("POST", "/api/auth/login", Object.fromEntries(form));
      router.push(res.redirect);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      if (message.includes("organization ID")) setNeedsOrg(true);
      setError(message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {needsOrg && (
          <Field label="Organization ID" hint='For example "harborline".'>
            <Input name="organization" required />
          </Field>
        )}
        <FormError message={error} />
        <button type="submit" className="btn btn--solid self-start" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </Card>
  );
}
