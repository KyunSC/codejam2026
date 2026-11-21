"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError, Input } from "@/components/forms/form-bits";
import { Button } from "@/components/ui";
import { send } from "@/lib/client/api";

/** "Mark explained" on one statement line or payment: a note, audited. */
export function ExplainForm({ slug, lineId, paymentId }: { slug: string; lineId?: string; paymentId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Mark explained</Button>;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/orgs/${slug}/reconciliation/explain`, { lineId, paymentId, note });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input aria-label="What is it?" placeholder="What is it?" className="input min-w-[220px]" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="solid" disabled={busy || !note.trim()} onClick={submit}>Save</Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
