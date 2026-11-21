import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, EmptyState, PersonCell, PrimaryCell, TableCard } from "@/components/ui";
import { FilterBar, FilterSelect, FilterText } from "@/components/filters";
import { listAccessRequests } from "@/lib/access/service";
import { ROLE_LABEL, canManageUsers } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/current";
import { formatDateTime, param } from "@/lib/format";
import { listUsers } from "@/lib/users/service";
import { DecideRequest } from "./decide-request";

type SP = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TEXT: Record<string, string> = { active: "Active", on_leave: "On leave", terminated: "Terminated" };

export default function SettingsPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading settings…</p>}>
        <SettingsView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SettingsView({ searchParams }: { searchParams: SP }) {
  const { user, org } = await requireUser();
  if (!canManageUsers(user.role)) return <p className="form-error">Settings are for controllers and admins.</p>;
  const sp = await searchParams;
  const tab = param(sp.tab) === "users" ? "users" : "requests";
  const pendingCount = (await listAccessRequests(org.id, { status: "pending" })).length;

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-8 text-[40px] leading-[.95] sm:text-[56px]">Settings</h1>
      <nav className="tabs" aria-label="Settings sections">
        <Link href="/settings" aria-current={tab === "requests" ? "page" : undefined}>
          Account requests{pendingCount > 0 && ` (${pendingCount} waiting)`}
        </Link>
        <Link href="/settings?tab=users" aria-current={tab === "users" ? "page" : undefined}>
          Users
        </Link>
      </nav>
      {tab === "requests" ? <Requests orgId={org.id} slug={org.slug} sp={sp} /> : <Users orgId={org.id} sp={sp} />}
    </>
  );
}

async function Requests({ orgId, slug, sp }: { orgId: string; slug: string; sp: Record<string, string | string[] | undefined> }) {
  const status = param(sp.status) || "pending";
  const q = param(sp.q);
  const [requests, users] = await Promise.all([
    listAccessRequests(orgId, { status: status === "any" ? undefined : status, q }),
    listUsers(orgId, { status: "active" }),
  ]);
  const departments = [...new Set(users.map((u) => u.departmentId).filter((d): d is string => !!d))].sort();
  const managers = users
    .filter((u) => u.role !== "employee")
    .map((u) => ({ id: u.id, label: `${u.fullName} (${ROLE_LABEL[u.role]})` }));

  return (
    <>
      <FilterBar action="/settings" resetHref="/settings">
        <FilterText name="q" label="Search" defaultValue={q} placeholder="Name or email" />
        <FilterSelect
          name="status"
          label="Status"
          defaultValue={status}
          allLabel={null}
          options={[
            { value: "pending", label: "Waiting" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
            { value: "any", label: "All" },
          ]}
        />
      </FilterBar>
      <div className="mt-8 flex flex-col gap-5">
        {requests.length === 0 ? (
          <EmptyState title={status === "pending" ? "No requests waiting" : "No requests match"}>
            People ask for an account from the Request access page with your organization ID.
          </EmptyState>
        ) : (
          requests.map((r) => (
            <DecideRequest
              key={r.id}
              slug={slug}
              request={{
                id: r.id,
                fullName: r.fullName,
                email: r.email,
                requestedRole: r.requestedRole,
                message: r.message,
                status: r.status,
                createdAt: formatDateTime(r.createdAt),
                decidedAt: r.decidedAt ? formatDateTime(r.decidedAt) : null,
                decisionNote: r.decisionNote,
              }}
              departments={departments}
              managers={managers}
            />
          ))
        )}
      </div>
    </>
  );
}

async function Users({ orgId, sp }: { orgId: string; sp: Record<string, string | string[] | undefined> }) {
  const filter = { q: param(sp.q), role: param(sp.role), status: param(sp.status), departmentId: param(sp.departmentId) };
  const [users, everyone] = await Promise.all([listUsers(orgId, filter), listUsers(orgId)]);
  const departments = [...new Set(everyone.map((u) => u.departmentId).filter((d): d is string => !!d))].sort();
  const names = Object.fromEntries(everyone.map((u) => [u.id, u.fullName]));

  return (
    <>
      <div className="mb-6 flex justify-end">
        <ButtonLink href="/settings/users/new" variant="solid">
          Add user
        </ButtonLink>
      </div>
      <FilterBar action="/settings" resetHref="/settings?tab=users">
        <input type="hidden" name="tab" value="users" />
        <FilterText name="q" label="Search" defaultValue={filter.q} placeholder="Name, email, title, ID" />
        <FilterSelect name="role" label="Role" defaultValue={filter.role} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect name="status" label="Status" defaultValue={filter.status} options={Object.entries(STATUS_TEXT).map(([value, label]) => ({ value, label }))} />
        <FilterSelect name="departmentId" label="Department" defaultValue={filter.departmentId} options={departments.map((d) => ({ value: d, label: d }))} />
      </FilterBar>
      <p className="muted mt-6 mb-3 text-sm">
        {users.length} of {everyone.length} users
      </p>
      {users.length === 0 ? (
        <EmptyState title="No users match">Change or clear the filters.</EmptyState>
      ) : (
        <TableCard label="Users" minWidth={900}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Manager</th>
              <th>Status</th>
              <th>Can log in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/settings/users/${u.id}`} className="no-underline hover:underline">
                    <PrimaryCell title={u.fullName} detail={[u.externalId, u.email].filter(Boolean).join(" · ")} />
                  </Link>
                </td>
                <td>
                  <PersonCell name={ROLE_LABEL[u.role]} role={u.title ?? undefined} />
                </td>
                <td className="text-sm">{u.departmentId ?? "—"}</td>
                <td className="text-sm">{u.managerId ? names[u.managerId] : "—"}</td>
                <td className="text-sm">
                  {STATUS_TEXT[u.status]}
                  {u.status === "on_leave" && u.delegateId && <div className="muted text-xs">Delegate: {names[u.delegateId]}</div>}
                </td>
                <td className="text-sm">{u.canLogIn ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
