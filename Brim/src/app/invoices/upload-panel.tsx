"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input, TextArea } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

/**
 * "Upload PDF": an AP clerk's files go to intake/uploads; an employee's go to intake/submissions
 * with an optional PO number and note.
 */
export function UploadPanel({ slug, asEmployee }: { slug: string; asEmployee: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await send<{ invoiceIds: string[] }>(
        "POST",
        `/api/orgs/${slug}/intake/${asEmployee ? "submissions" : "uploads"}`,
        form,
      );
      setDone(`${res.invoiceIds.length} invoice${res.invoiceIds.length === 1 ? "" : "s"} added.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-3">
      <button type="button" className="btn btn--solid" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Upload PDF
      </button>
      {done && !open && (
        <p role="status" className="form-ok m-0">
          {done}
        </p>
      )}
      {open && (
        <Card className="w-full max-w-[420px] p-5">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Invoice files" hint="PDF or image. You can pick several.">
              <Input name="files" type="file" accept="application/pdf,image/png,image/jpeg" multiple required />
            </Field>
            {asEmployee && (
              <>
                <Field label="PO number" hint="Optional.">
                  <Input name="poNumber" />
                </Field>
                <Field label="Note" hint="Optional: what it's for.">
                  <TextArea name="note" />
                </Field>
              </>
            )}
            <FormError message={error} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn--solid btn--sm" disabled={busy}>
                {busy ? "Uploading…" : "Upload"}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
