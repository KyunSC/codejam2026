"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { Field, FormError, Input, Select } from "@/components/forms/form-bits";
import { ROLE_OPTIONS } from "@/lib/client/roles";
import { send } from "@/lib/client/api";

export interface UserFormValues {
  id?: string;
  externalId: string;
  fullName: string;
  email: string;
  title: string;
  role: string;
  departmentId: string;
  managerId: string;
  delegateId: string;
  approvalLimitCad: string;
  workProvince: string;
  status: string;
  statusSince: string;
  hireDate: string;
}

/** Add or edit a user. Blank optional fields are saved as empty. */
export function UserForm({
  slug,
  initial,
  people,
  departments,
}: {
  slug: string;
  initial: UserFormValues;
  people: { id: string; label: string }[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const editing = !!initial.id;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const raw = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === "password") {
        if (v) body.password = v;
      } else body[k] = v === "" ? null : v;
    }
    body.approvalLimitCad = raw.approvalLimitCad || 0;
    try {
      if (editing) await send("PATCH", `/api/orgs/${slug}/users/${initial.id}`, body);
      else await send("POST", `/api/orgs/${slug}/users`, body);
      router.push("/settings?tab=users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial.id || !confirm(`Delete ${initial.fullName}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await send("DELETE", `/api/orgs/${slug}/users/${initial.id}`);
      router.push("/settings?tab=users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deleting failed.");
      setBusy(false);
    }
  }

  const others = people.filter((p) => p.id !== initial.id);

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <Card className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2 sm:p-8">
        <Field label="Full name">
          <Input name="fullName" defaultValue={initial.fullName} required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={initial.email} required />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue={initial.role || "employee"}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input name="title" defaultValue={initial.title} />
        </Field>
        <Field label="Department">
          <Select name="departmentId" defaultValue={initial.departmentId}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employee ID" hint='Your own ID for the person, e.g. "U041".'>
          <Input name="externalId" defaultValue={initial.externalId} />
        </Field>
        <Field label="Manager">
          <Select name="managerId" defaultValue={initial.managerId}>
            <option value="">None</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Approval limit (CAD)">
          <Input name="approvalLimitCad" inputMode="decimal" defaultValue={initial.approvalLimitCad} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial.status || "active"}>
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="terminated">Terminated</option>
          </Select>
        </Field>
        <Field label="Status since">
          <Input name="statusSince" type="date" defaultValue={initial.statusSince} />
        </Field>
        <Field label="Delegate while away">
          <Select name="delegateId" defaultValue={initial.delegateId}>
            <option value="">None</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Work province">
          <Input name="workProvince" defaultValue={initial.workProvince} />
        </Field>
        <Field label="Hire date">
          <Input name="hireDate" type="date" defaultValue={initial.hireDate} />
        </Field>
        <Field label={editing ? "New password" : "Password"} hint={editing ? "Leave blank to keep the current one." : "Optional. Without one, the person can't log in yet."}>
          <Input name="password" type="password" minLength={8} autoComplete="new-password" />
        </Field>
      </Card>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn--solid" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add user"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => router.push("/settings?tab=users")}>
          Cancel
        </button>
        {editing && (
          <button type="button" className="btn btn--ghost ml-auto" onClick={remove} disabled={busy}>
            Delete user
          </button>
        )}
      </div>
    </form>
  );
}
