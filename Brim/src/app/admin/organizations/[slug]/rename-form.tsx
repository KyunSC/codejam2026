"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError, Input } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

export function RenameForm({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/admin/organizations/${slug}`, { name: new FormData(e.currentTarget).get("name") });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renaming failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-[560px] flex-col gap-3">
      <div className="flex gap-3">
        <label className="sr-only" htmlFor="org-name">
          Organization name
        </label>
        <Input id="org-name" name="name" defaultValue={name} required />
        <button type="submit" className="btn btn--ghost btn--sm" disabled={busy}>
          Rename
        </button>
      </div>
      <FormError message={error} />
    </form>
  );
}
