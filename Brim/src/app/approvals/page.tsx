import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PrimaryCell, SectionHeading, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { waitingForMe } from "@/lib/workflow/queues";
import { DelegationForm } from "./delegation-form";

const ROLE_STEP: Record<string, string> = {
  dept_manager: "Department manager",
  finance_manager: "Finance manager",
  controller_admin: "Controller",
  cfo: "CFO",
};

export default function ApprovalsPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <ApprovalsView />
      </Suspense>
    </main>
  );
}

async function ApprovalsView() {
  const { user, org } = await requireUser();
  if (!roleCan(user.role, "invoice.decide")) redirect("/invoices");
  const rows = await waitingForMe(user);
  const colleagues = await db().user.findMany({
    where: { organizationId: org.id, id: { not: user.id }, status: "active", role: { in: ["approver", "finance_manager", "controller_admin"] } },
    orderBy: { fullName: "asc" },
    select: { id: true, externalId: true, fullName: true, title: true },
  });
  const myDelegate = user.delegateId ? colleagues.find((c) => c.id === user.delegateId) : undefined;

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Waiting for me</h1>
      <p className="muted m-0 mb-8 max-w-[60ch] text-[15px]">
        Invoices whose current approval step is yours, including steps you hold for someone on leave. Open one to see
        its flags, coding and chain, then approve or reject.
      </p>

      {rows.length === 0 ? (
        <EmptyState title="Nothing waiting for you">New approval steps assigned to you will appear here.</EmptyState>
      ) : (
        <TableCard label="Approvals waiting for me" minWidth={760}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Step</th>
              <th>Why you</th>
              <th>Due</th>
              <th className="amt">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stepId}>
                <td>
                  <Link href={`/invoices/${r.invoice.id}`} className="no-underline">
                    <PrimaryCell title={r.invoice.vendorName ?? r.invoice.id} detail={`${r.invoice.id} · ${r.invoice.invoiceNumber ?? "no number"} · ${r.invoice.departmentId ?? "no department"}`} />
                  </Link>
                </td>
                <td>
                  {r.stepNo} of {r.stepCount} · {ROLE_STEP[r.role] ?? r.role}
                  {r.actingFor && <span className="mt-1 block text-sm">acting for {r.actingFor} (on leave)</span>}
                </td>
                <td className="muted text-sm">
                  {r.why.ruleIds.join(", ")}
                  {r.why.replacements.length > 0 && <span className="block">{r.why.replacements.join("; ")}</span>}
                </td>
                <td className="num">{r.invoice.dueDate ? formatDate(r.invoice.dueDate) : "—"}</td>
                <td className="amt">
                  {formatMoney(r.invoice.total, r.invoice.currency)}
                  {r.invoice.currency !== "CAD" && r.invoice.totalCad && <span className="muted block text-sm">{formatMoney(r.invoice.totalCad, "CAD")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      <section aria-labelledby="delegate" className="mt-12 max-w-[640px]">
        <SectionHeading id="delegate" level={3}>
          My delegate
        </SectionHeading>
        <DelegationForm
          slug={org.slug}
          current={{ delegateId: myDelegate ? (myDelegate.externalId ?? myDelegate.id) : "", onLeave: user.status === "on_leave" }}
          options={colleagues.map((c) => ({ id: c.externalId ?? c.id, label: `${c.fullName}${c.title ? `, ${c.title}` : ""}` }))}
        />
      </section>
    </>
  );
}
