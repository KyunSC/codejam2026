"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError, Select } from "@/components/forms/form-bits";
import { send } from "@/lib/client/api";
import { OFFICES, PROVINCE_NAMES } from "@/lib/rules/offices";

/** Runs the checks on a typed invoice saved before typed invoices were checked. */
export function RunChecks({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  const router = useRouter();
  const [deliveredTo, setDeliveredTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/orgs/${slug}/invoices/${invoiceId}/check-typed`, { deliveredTo: deliveredTo || null });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The checks didn't run.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">Delivered to</span>
          <Select value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} aria-label="Delivered to">
            <option value="">Not shown on the invoice</option>
            {OFFICES.map((o) => (
              <option key={o.province} value={o.province}>
                {o.city} ({PROVINCE_NAMES[o.province]})
              </option>
            ))}
          </Select>
        </label>
        <button type="button" className="btn btn--solid btn--sm" onClick={run} disabled={busy}>
          {busy ? "Running checks…" : "Run checks"}
        </button>
      </div>
      <p className="muted m-0 text-xs">The office decides which tax the checks expect. Without it, the invoice is held until someone sets it.</p>
      <FormError message={error} />
    </div>
  );
}
