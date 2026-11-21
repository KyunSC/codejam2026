import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumb, EmptyState, PrimaryCell, SectionHeading, StateCard, TableCard } from "@/components/ui";
import { FilterBar, FilterSelect, FilterText } from "@/components/filters";
import { listAccessRequests } from "@/lib/access/service";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/current";
import { formatDate, formatDateTime, param } from "@/lib/format";
import { AppError } from "@/lib/http";
import { getOrganizationBySlug } from "@/lib/organizations/service";
import { listUsers } from "@/lib/users/service";
import { RenameForm } from "./rename-form";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function OrgAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-8 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <View params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function View({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  await requireStaff();
  const { slug } = await params;
  let org;
  try {
    org = await getOrganizationBySlug(slug);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return <p className="form-error">{err.message}</p>;
    throw err;
  }
  const sp = await searchParams;
  const filter = { q: param(sp.q), role: param(sp.role) };
  const [users, requests] = await Promise.all([listUsers(org.id, filter), listAccessRequests(org.id, { status: "pending" })]);
  const admins = users.filter((u) => u.role === "controller_admin");

  return (
    <>
      <Breadcrumb items={[{ label: "Organizations", href: "/admin" }, { label: org.name }]} />
      <h1 className="heading mt-4 mb-6 text-[36px] leading-[.95] sm:text-[52px]">{org.name}</h1>
      <StateCard
        items={[
          { label: "ID", value: <span className="label">{org.slug}</span> },
          { label: "Users", value: <span className="num">{org._count.users}</span> },
          { label: "Invoices", value: <span className="num">{org._count.invoices}</span> },
          { label: "Account requests waiting", value: <span className="num">{requests.length}</span> },
          { label: "Onboarded", value: <span className="num">{formatDate(org.createdAt)}</span> },
        ]}
      />

      <section aria-labelledby="rename" className="mt-10">
        <SectionHeading id="rename" level={3}>
          Name
        </SectionHeading>
        <RenameForm slug={org.slug} name={org.name} />
      </section>

      {requests.length > 0 && (
        <section aria-labelledby="waiting" className="mt-10">
          <SectionHeading id="waiting" level={3}>
            Waiting for the organization&rsquo;s admins
          </SectionHeading>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
            {requests.map((r) => (
              <li key={r.id}>
                {r.fullName} <span className="muted">· {r.email} · asked {formatDateTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="people" className="mt-10">
        <SectionHeading id="people" level={3}>
          Users
        </SectionHeading>
        <FilterBar action={`/admin/organizations/${org.slug}`} resetHref={`/admin/organizations/${org.slug}`}>
          <FilterText name="q" label="Search" defaultValue={filter.q} placeholder="Name, email, title, ID" />
          <FilterSelect name="role" label="Role" defaultValue={filter.role} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        </FilterBar>
        {!filter.q && !filter.role && admins.length === 0 && (
          <p className="form-error mt-4">This organization has no controller/admin, so nobody there can approve account requests.</p>
        )}
        <div className="mt-6">
          {users.length === 0 ? (
            <EmptyState title="No users match" />
          ) : (
            <TableCard label="Users" minWidth={700}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <PrimaryCell title={u.fullName} detail={[u.externalId, u.email].filter(Boolean).join(" · ")} />
                    </td>
                    <td className="text-sm">{ROLE_LABEL[u.role]}</td>
                    <td className="text-sm">{u.departmentId ?? "—"}</td>
                    <td className="text-sm">{u.status.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          )}
        </div>
      </section>
      <p className="mt-10">
        <Link href="/admin" className="underline underline-offset-4">
          Back to all organizations
        </Link>
      </p>
    </>
  );
}
