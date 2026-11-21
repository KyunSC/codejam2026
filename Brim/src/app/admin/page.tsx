import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PrimaryCell, SectionHeading, TableCard } from "@/components/ui";
import { FilterBar, FilterSelect, FilterText } from "@/components/filters";
import { LogoutButton } from "@/components/shell/logout-button";
import { requireStaff } from "@/lib/auth/current";
import { formatDate, param } from "@/lib/format";
import { listOrganizations } from "@/lib/organizations/service";
import { OnboardForm } from "./onboard-form";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function AdminPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <AdminView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AdminView({ searchParams }: { searchParams: SP }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const q = param(sp.q);
  const pending = param(sp.pending);
  let orgs = await listOrganizations(q);
  if (pending === "yes") orgs = orgs.filter((o) => o._count.accessRequests > 0);

  return (
    <>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label muted m-0 mb-3 text-sm">Brim admin · {staff.fullName}</p>
          <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[56px]">Organizations</h1>
        </div>
        <LogoutButton staff />
      </div>

      <section aria-labelledby="onboard" className="mb-12">
        <SectionHeading id="onboard" level={3}>
          Onboard an organization
        </SectionHeading>
        <OnboardForm />
      </section>

      <section aria-labelledby="list">
        <SectionHeading id="list" level={3}>
          All organizations
        </SectionHeading>
        <FilterBar action="/admin" resetHref="/admin">
          <FilterText name="q" label="Search" defaultValue={q} placeholder="Name or ID" />
          <FilterSelect
            name="pending"
            label="Account requests"
            defaultValue={pending}
            allLabel="Any"
            options={[{ value: "yes", label: "Some waiting" }]}
          />
        </FilterBar>
        <div className="mt-6">
          {orgs.length === 0 ? (
            <EmptyState title="No organizations match">Change the search, or onboard one above.</EmptyState>
          ) : (
            <TableCard label="Organizations" minWidth={760}>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th className="amt">Users</th>
                  <th className="amt">Invoices</th>
                  <th className="amt">Requests waiting</th>
                  <th>Onboarded</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/organizations/${o.slug}`} className="no-underline hover:underline">
                        <PrimaryCell title={o.name} detail={`ID: ${o.slug}`} />
                      </Link>
                    </td>
                    <td className="amt">{o._count.users}</td>
                    <td className="amt">{o._count.invoices}</td>
                    <td className="amt">{o._count.accessRequests}</td>
                    <td className="num text-sm">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          )}
        </div>
      </section>
    </>
  );
}
