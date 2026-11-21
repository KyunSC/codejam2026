import Link from "next/link";
import { Suspense } from "react";
import { PrimaryCell, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { param } from "@/lib/format";
import { listVendors } from "@/lib/workflow/vendors";
import { OnboardForm } from "./vendor-actions";

type SP = Promise<Record<string, string | string[] | undefined>>;

const STATUS_TEXT: Record<string, string> = { active: "Active", pending_review: "Pending review", on_hold: "On hold" };

export default function VendorsPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading vendors…</p>}>
        <VendorsView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function VendorsView({ searchParams }: { searchParams: SP }) {
  const { user, org } = await requireUser();
  const q = param((await searchParams).q);
  const vendors = (await listVendors(user, q)) as Array<Record<string, unknown> & { id: string; legalName: string; category: string; status: string }>;
  const waiting = vendors.filter((v) => v.status !== "active");
  const ordered = [...waiting, ...vendors.filter((v) => v.status === "active")];

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Vendors</h1>
      <p className="muted m-0 mb-6 max-w-[64ch] text-[15px]">
        {waiting.length} of {vendors.length} vendors are pending review or on hold, listed first. Their invoices can be reviewed and coded but not paid.
      </p>
      <form className="mb-6 flex gap-2" action="/vendors">
        <input className="input max-w-[320px]" name="q" defaultValue={q} placeholder="Search by name or id" aria-label="Search vendors" />
        <button className="btn btn--ghost btn--sm" type="submit">Search</button>
      </form>
      <TableCard label="Vendors" minWidth={640}>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Category</th>
            <th>Pays by</th>
            <th>Bank</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((v) => {
            const bank = v.bank as { last4?: string | null; account?: string | null } | null | undefined;
            return (
              <tr key={v.id}>
                <td>
                  <Link href={`/vendors/${v.id}`} className="no-underline">
                    <PrimaryCell title={v.legalName} detail={v.id} />
                  </Link>
                </td>
                <td>{v.category}</td>
                <td>{(v.preferredPaymentMethod as string | undefined) ?? "—"}</td>
                <td className="num">{bank === undefined ? <span className="muted">hidden</span> : bank ? (bank.last4 ?? "—") : "none"}</td>
                <td className={v.status === "active" ? "" : "form-error"}>{STATUS_TEXT[v.status] ?? v.status}</td>
              </tr>
            );
          })}
        </tbody>
      </TableCard>
      {roleCan(user.role, "vendor.onboard") && (
        <section className="mt-12 max-w-[720px]">
          <h2 className="heading mb-4 text-2xl">Onboard a vendor</h2>
          <OnboardForm slug={org.slug} />
        </section>
      )}
    </>
  );
}
