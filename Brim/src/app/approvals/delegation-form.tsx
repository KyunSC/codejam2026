"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { FormError, Select } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

/** Name who approves for me while I am on leave. Their decisions are recorded as made on my behalf. */
export function DelegationForm({
  slug,
  current,
  options,
}: {
  slug: string;
  current: { delegateId: string; onLeave: boolean };
  options: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [delegateId, setDelegateId] = useState(current.delegateId);
  const [onLeave, setOnLeave] = useState(current.onLeave);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await send("PUT", `/api/orgs/${slug}/me/delegation`, { delegateId: delegateId || null, onLeave });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <label className="field">
        <span>Delegate</span>
        <Select value={delegateId} onChange={(e) => setDelegateId(e.target.value)}>
          <option value="">Nobody</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2.5 text-[15px]">
        <input type="checkbox" checked={onLeave} onChange={(e) => setOnLeave(e.target.checked)} />
        I am on leave: my approval steps go to my delegate
      </label>
      <div className="flex items-center gap-3">
        <Button variant="solid" size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
        {saved && <span className="muted text-sm">Saved.</span>}
      </div>
      <FormError message={error} />
    </Card>
  );
}
