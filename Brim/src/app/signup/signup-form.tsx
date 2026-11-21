"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input, Select, TextArea } from "@/components/forms/form-bits";
import { ROLE_OPTIONS } from "@/lib/client/roles";
import { send } from "@/lib/client/api";

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await send("POST", "/api/auth/signup", form);
      setDone(String(form.email));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col gap-2 p-6 sm:p-8">
        <p className="label m-0">Request sent</p>
        <p className="muted m-0 text-[15px]">
          An administrator at your organization will review it. Log in with {done} once it&rsquo;s approved.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Organization ID" hint='Ask your administrator. For example "harborline".'>
          <Input name="organization" required autoComplete="organization" />
        </Field>
        <Field label="Full name">
          <Input name="fullName" required autoComplete="name" />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Role you need" hint="Your administrator decides the role you get.">
          <Select name="requestedRole" defaultValue="employee">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note to the administrator" hint="Optional: your department, your manager.">
          <TextArea name="message" />
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn btn--solid self-start" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
    </Card>
  );
}
