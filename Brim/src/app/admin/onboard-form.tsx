"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

/** Creates an organization and its first controller/admin, who then approves everyone else. */
export function OnboardForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setBusy(true);
    setError(null);
    setDone(null);
    const f = Object.fromEntries(new FormData(formEl)) as Record<string, string>;
    try {
      const org = await send<{ slug: string; name: string }>("POST", "/api/admin/organizations", {
        slug: f.slug,
        name: f.name,
        admin: { fullName: f.adminName, email: f.adminEmail, password: f.adminPassword },
      });
      setDone(`${org.name} is set up. ${f.adminEmail} can log in now; others request access with the ID "${org.slug}".`);
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Organization name">
          <Input name="name" required placeholder="Harborline Logistics Inc." />
        </Field>
        <Field label="Organization ID" hint="Lower-case letters, digits and hyphens. People type it to request access. It can't change later.">
          <Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="harborline" />
        </Field>
        <Field label="First admin: full name">
          <Input name="adminName" required />
        </Field>
        <Field label="First admin: email">
          <Input name="adminEmail" type="email" required />
        </Field>
        <Field label="First admin: password" hint="At least 8 characters. Share it with them directly.">
          <Input name="adminPassword" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <div className="flex flex-col justify-end gap-3 sm:col-span-2">
          <FormError message={error} />
          {done && (
            <p role="status" className="form-ok m-0">
              {done}
            </p>
          )}
          <button type="submit" className="btn btn--solid self-start" disabled={busy}>
            {busy ? "Setting up…" : "Onboard"}
          </button>
        </div>
      </form>
    </Card>
  );
}
