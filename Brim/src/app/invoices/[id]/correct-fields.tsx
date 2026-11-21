"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, Input, Select } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";

/** The printed fields a clerk may correct to match the paper. Line and tax amounts are not among them. */
export type CorrectableField = "invoiceNumber" | "invoiceDate" | "dueDate" | "poNumber" | "subtotal" | "total";

const LABEL: Record<CorrectableField, string> = {
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
  poNumber: "PO number",
  subtotal: "Subtotal",
  total: "Total",
};
const ORDER: CorrectableField[] = ["invoiceNumber", "invoiceDate", "dueDate", "poNumber", "subtotal", "total"];

/**
 * "Correct a value": fixes a value that was read or typed wrong, so it matches the invoice as
 * printed. Not for changing what the vendor billed: that is a policy flag to override, or a
 * rejection back to the vendor. A reason is required and kept in the audit log with both values.
 */
export function CorrectFields({
  slug,
  invoiceId,
  version,
  current,
}: {
  slug: string;
  invoiceId: string;
  version: number;
  current: Record<CorrectableField, string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<CorrectableField>("total");
  const [value, setValue] = useState(current.total ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: CorrectableField) {
    setField(f);
    setValue(current[f] ?? "");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/orgs/${slug}/invoices/${invoiceId}`, { fields: { [field]: value.trim() || null }, reason }, { "If-Match": String(version) });
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The correction wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-5">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
          Correct a value
        </button>
        <p className="muted m-0 mt-2 text-xs">For a value read or typed wrong. If the vendor billed it wrong, override the flag or reject the invoice instead.</p>
      </div>
    );
  }

  const isDate = field === "invoiceDate" || field === "dueDate";
  const isMoney = field === "subtotal" || field === "total";
  return (
    <form onSubmit={save} className="mt-5 flex flex-col gap-4 border-t-2 border-border pt-5">
      <p className="label m-0">Correct a value to match the invoice</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Field">
          <Select value={field} onChange={(e) => pick(e.target.value as CorrectableField)}>
            {ORDER.map((f) => (
              <option key={f} value={f}>
                {LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="As printed on the invoice" hint={`Now: ${current[field] ?? "not filled in"}`}>
          <Input
            type={isDate ? "date" : "text"}
            inputMode={isMoney ? "decimal" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Why" hint="Say what the invoice shows, e.g. “The PDF shows a total of $3,439.00.” Kept in the audit log.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
      </Field>
      <FormError message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn btn--solid btn--sm" disabled={busy || !reason.trim()}>
          {busy ? "Saving…" : "Save correction"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="muted m-0 text-xs">The checks run again after you save.</p>
    </form>
  );
}
