"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input, Select } from "@/components/forms/form-bits";
import { ROLE_OPTIONS, ROLE_TEXT } from "@/lib/client/roles";
import { send } from "@/lib/client/api";

export interface RequestView {
  id: string;
  fullName: string;
  email: string;
  requestedRole: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

/** One account request. Waiting ones can be approved (choosing role, department, manager) or rejected. */
export function DecideRequest({
  slug,
  request: r,
  departments,
  managers,
}: {
  slug: string;
  request: RequestView;
  departments: { id: string; name: string }[];
  managers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(kind: "approve" | "reject", form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(form));
    try {
      await send("POST", `/api/orgs/${slug}/access-requests/${r.id}/${kind}`, body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="label m-0">{r.fullName}</p>
          <p className="muted m-0 text-sm">
            {r.email} · asked {r.createdAt}
            {r.requestedRole && ` · wants ${ROLE_TEXT[r.requestedRole]}`}
          </p>
        </div>
        {r.status !== "pending" && (
          <span className="label text-sm">
            {r.status === "approved" ? "Approved" : "Rejected"} {r.decidedAt}
          </span>
        )}
      </div>
      {r.message && <p className="m-0 whitespace-pre-wrap text-[15px]">&ldquo;{r.message}&rdquo;</p>}
      {r.decisionNote && <p className="muted m-0 text-sm">Note: {r.decisionNote}</p>}
      {r.status === "pending" && (
        <DecisionForm onDecide={decide} busy={busy} requestedRole={r.requestedRole} departments={departments} managers={managers} />
      )}
      <FormError message={error} />
    </Card>
  );
}

function DecisionForm({
  onDecide,
  busy,
  requestedRole,
  departments,
  managers,
}: {
  onDecide: (kind: "approve" | "reject", form: HTMLFormElement) => void;
  busy: boolean;
  requestedRole: string | null;
  departments: { id: string; name: string }[];
  managers: { id: string; label: string }[];
}) {
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))]"
    >
      <Field label="Give role">
        <Select name="role" defaultValue={requestedRole ?? "employee"}>
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Department">
        <Select name="departmentId" defaultValue="">
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Manager">
        <Select name="managerId" defaultValue="">
          <option value="">None</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note" hint="Optional; kept with the decision.">
        <Input name="note" />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <button type="button" className="btn btn--solid btn--sm" disabled={busy} onClick={(e) => onDecide("approve", e.currentTarget.form!)}>
          Approve
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={(e) => onDecide("reject", e.currentTarget.form!)}>
          Reject
        </button>
      </div>
    </form>
  );
}
