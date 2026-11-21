import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, TableCard } from "@/components/ui";
import { FilterBar, FilterSelect, FilterText } from "@/components/filters";
import { accessRequestPeople } from "@/lib/access/service";
import { type Actor, listActions, listGroupRows } from "@/lib/audit";
import { groupIntoActions } from "@/lib/audit-groups";
import { actionText, actorText } from "@/lib/audit-text";
import { type AuditRowView, AuditEntries } from "./audit-rows";
import { canViewAudit } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { formatDateTime, param } from "@/lib/format";
import { listUsers } from "@/lib/users/service";
import { VerifyChain } from "./verify-chain";

type SP = Promise<Record<string, string | string[] | undefined>>;
const PAGE = 100;

const ACTIONS = [
  "invoice.received",
  "invoice.created",
  "email.received",
  "user.created",
  "user.updated",
  "user.password_set",
  "user.deleted",
  "user.logged_in",
  "access_request.created",
  "access_request.approved",
  "access_request.rejected",
  "organization.created",
  "organization.updated",
  "invoice.processed",
  "invoice.checked",
  "invoice.edit",
  "invoice.submit",
  "invoice.approve",
  "invoice.reject",
  "invoice.duplicate",
  "flag.override",
  "flag.confirm",
  "email.label",
  "payment.prepare",
  "payment.release",
  "payment.settled",
  "payment.failed",
  "vendor.onboard",
  "vendor.approve",
  "vendor.hold",
  "vendor.release_hold",
  "vendor.bank_change.request",
  "vendor.bank_change.verify",
  "vendor.bank_change.reject",
  "user.delegation",
];
const ENTITIES = ["invoice", "payment", "vendor", "flag", "bank_change", "email", "user", "access_request", "organization"];
const ACTOR_TYPES: { value: Actor["type"]; label: string }[] = [
  { value: "user", label: "A person" },
  { value: "llm", label: "The reader (LLM)" },
  { value: "system", label: "Brim (automatic)" },
  { value: "brim_admin", label: "Brim staff" },
];

export default function AuditPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading the audit log…</p>}>
        <AuditView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Field names whose value differs between before and after. */
function changedFields(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a).filter((k) => k !== "updatedAt" && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** The admin's note on an approved or rejected account request, from the row's `after`. */
function decisionNote(after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const v = (after as Record<string, unknown>).decisionNote;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function AuditView({ searchParams }: { searchParams: SP }) {
  const { user, org } = await requireUser();
  if (!canViewAudit(user.role)) return <p className="form-error">The audit log is for controllers, admins and auditors.</p>;
  const sp = await searchParams;
  const f = {
    q: param(sp.q),
    actorId: param(sp.actorId),
    actorType: param(sp.actorType),
    action: param(sp.action),
    entityType: param(sp.entityType),
    invoiceId: param(sp.invoiceId),
    paymentId: param(sp.paymentId),
    from: param(sp.from),
    to: param(sp.to),
    beforeSeq: param(sp.beforeSeq),
  };
  const [rows, users] = await Promise.all([
    listActions(org.id, {
      q: f.q || undefined,
      actorId: f.actorId || undefined,
      actorType: (ACTOR_TYPES.find((t) => t.value === f.actorType)?.value as Actor["type"]) || undefined,
      action: f.action || undefined,
      entityType: f.entityType || undefined,
      invoiceId: f.invoiceId || undefined,
      paymentId: f.paymentId || undefined,
      from: f.from ? `${f.from}T00:00:00` : undefined,
      to: f.to ? `${f.to}T23:59:59.999` : undefined,
      beforeSeq: /^\d+$/.test(f.beforeSeq) ? BigInt(f.beforeSeq) : undefined,
      limit: PAGE,
    }),
    listUsers(org.id),
  ]);
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const beforeSeq = /^\d+$/.test(f.beforeSeq) ? BigInt(f.beforeSeq) : undefined;
  const groupRows = await listGroupRows(
    org.id,
    rows.map((r) => r.actionGroupId).filter((g): g is string => !!g),
  );
  const entries = groupIntoActions(rows, groupRows, beforeSeq);
  const shown = entries.flatMap((e) => [e.head, ...e.parts]);
  const requesters = await accessRequestPeople(
    org.id,
    shown.filter((r) => r.entityType === "access_request").map((r) => r.entityId),
  );

  const view = (r: (typeof rows)[number]): AuditRowView => {
    const requester = r.entityType === "access_request" ? requesters[r.entityId] : undefined;
    // A sign-up is logged as automatic (the person has no account yet); show who signed up.
    const selfRequest = r.action === "access_request.created" && r.actorType === "system" && requester;
    return {
      seq: r.seq.toString(),
      when: formatDateTime(r.at),
      who: selfRequest ? requester.fullName : actorText(r, r.actorId ? names[r.actorId] : null),
      whoDetail: selfRequest ? `${requester.email} · signing up` : null,
      onBehalfOf: r.onBehalfOfId ? (names[r.onBehalfOfId] ?? r.onBehalfOfId) : null,
      what: actionText(r.action),
      reason: r.reason,
      note: r.action.startsWith("access_request.") ? decisionNote(r.after) : null,
      record: requester
        ? { text: `account request from ${requester.fullName}`, href: `/settings?status=any&q=${encodeURIComponent(requester.email)}` }
        : r.entityType === "invoice"
          ? { text: "invoice", href: `/invoices/${r.entityId}` }
          : r.entityType === "payment"
            ? { text: "payment (audit pack)", href: `/audit/pack/${r.entityId}` }
            : r.entityType === "vendor"
              ? { text: "vendor", href: `/vendors/${r.entityId}` }
          : r.entityType === "user" && names[r.entityId]
            ? { text: `user ${names[r.entityId]}`, href: null }
            : { text: r.entityType.replace("_", " "), href: null },
      entityId: r.entityId,
      changed: changedFields(r.before, r.after),
    };
  };
  const older = new URLSearchParams(Object.entries({ ...f, beforeSeq: rows.at(-1)?.seq.toString() ?? "" }).filter(([, v]) => v));

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Audit log</h1>
      <p className="muted m-0 mb-8 max-w-[60ch] text-[15px]">
        Every action by a person, by Brim or by the reader, newest first. Entries are never edited or deleted.
      </p>
      {user.role === "auditor" && (
        <p className="form-error mb-6">You are signed in as the auditor: everything is read-only. Exports and the chain check change nothing.</p>
      )}
      <div className="mb-8 flex flex-wrap items-start gap-4">
        <a className="btn btn--ghost btn--sm" href={`/api/orgs/${org.slug}/audit/export.csv?${new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "beforeSeq"))}`}>
          Export these entries (CSV)
        </a>
        <VerifyChain slug={org.slug} />
      </div>
      <FilterBar action="/audit" resetHref="/audit">
        <FilterText name="q" label="Search" defaultValue={f.q} placeholder="Action, record or invoice ID, reason" />
        <FilterSelect
          name="actorId"
          label="Person"
          defaultValue={f.actorId}
          allLabel="Anyone"
          options={users.map((u) => ({ value: u.id, label: u.fullName }))}
        />
        <FilterSelect name="actorType" label="Kind of actor" defaultValue={f.actorType} options={ACTOR_TYPES} />
        <FilterSelect name="action" label="Action" defaultValue={f.action} options={ACTIONS.map((a) => ({ value: a, label: actionText(a) }))} />
        <FilterSelect name="entityType" label="Record" defaultValue={f.entityType} options={ENTITIES.map((e) => ({ value: e, label: e.replace("_", " ") }))} />
        <FilterText name="from" label="From" type="date" defaultValue={f.from} />
        <FilterText name="to" label="To" type="date" defaultValue={f.to} />
        <FilterText name="invoiceId" label="Invoice" defaultValue={f.invoiceId} placeholder="AP-00100" />
        <FilterText name="paymentId" label="Payment" defaultValue={f.paymentId} placeholder="PAY-00096" />
      </FilterBar>

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState title="No entries match">Change or clear the filters.</EmptyState>
        ) : (
          <TableCard label="Audit log" minWidth={980}>
            <thead>
              <tr>
                <th className="w-8 pr-0">
                  <span className="sr-only">Expand</span>
                </th>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Record</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              <AuditEntries entries={entries.map((e) => ({ head: view(e.head), parts: e.parts.map(view) }))} />
            </tbody>
          </TableCard>
        )}
        {rows.length === PAGE && (
          <div className="mt-6">
            <Link href={`/audit?${older}`} className="btn btn--ghost btn--sm">
              Older entries
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
