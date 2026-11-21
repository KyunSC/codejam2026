import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumb, Card, SectionHeading, StateCard, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { AppError } from "@/lib/http";
import { getVendor } from "@/lib/workflow/vendors";
import { BankChangeDecision, BankChangeForm, VendorStatusActions } from "../vendor-actions";

export default function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-8 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading vendor…</p>}>
        <VendorView params={params} />
      </Suspense>
    </main>
  );
}

async function VendorView({ params }: { params: Promise<{ id: string }> }) {
  const { user, org } = await requireUser();
  const { id } = await params;
  let data;
  try {
    data = await getVendor(user, id);
  } catch (e) {
    if (e instanceof AppError) return <p className="form-error">{e.message}</p>;
    throw e;
  }
  const v = data.vendor as Record<string, unknown> & { id: string; legalName: string; status: string; category: string };
  const bank = v.bank as { institution?: string | null; transit?: string | null; account?: string | null; last4?: string | null } | null | undefined;
  const people = await db().user.findMany({ where: { organizationId: org.id }, select: { id: true, fullName: true } });
  const name = (rowId: string | null | undefined) => (rowId ? (people.find((p) => p.id === rowId)?.fullName ?? rowId) : "—");
  const canDecide = roleCan(user.role, "vendor.approve");

  return (
    <>
      <Breadcrumb items={[{ label: "Vendors", href: "/vendors" }, { label: v.legalName }]} />
      <h1 className="heading mt-4 mb-6 text-[36px] leading-[.95] sm:text-[52px]">{v.legalName}</h1>
      <StateCard
        items={[
          { label: "Status", value: <span className={v.status === "active" ? "label" : "label form-error"}>{v.status.replace("_", " ")}</span> },
          { label: "Category", value: v.category },
          { label: "Pays by", value: (v.preferredPaymentMethod as string) ?? "—" },
          {
            label: "Bank account",
            value:
              bank === undefined ? <span className="muted">Not shown to your role</span> : bank ? `${bank.institution ? `${bank.institution}-${bank.transit} ` : ""}${bank.account ?? bank.last4}` : "None on file",
          },
          { label: "Created by", value: data.createdById ? name(data.createdById) : "Imported" },
        ]}
      />

      {canDecide && (
        <div className="mt-6">
          <VendorStatusActions slug={org.slug} vendorId={v.id} status={v.status} />
        </div>
      )}

      {data.flags.length > 0 && (
        <section className="mt-10">
          <SectionHeading id="vflags" level={3}>Open flags on this vendor&apos;s invoices</SectionHeading>
          <Card className="flex flex-col gap-2 p-6 text-[15px]">
            {data.flags.map((f) => (
              <p key={f.id} className="m-0">
                <b>{f.code}</b> on <Link href={`/invoices/${f.invoiceId}`}>{f.invoiceId}</Link>: {f.message}
              </p>
            ))}
          </Card>
        </section>
      )}

      {bank !== undefined && (
        <section className="mt-10">
          <SectionHeading id="bank" level={3}>Bank changes</SectionHeading>
          {data.bankChanges.length > 0 ? (
            <div className="flex flex-col gap-4">
              {data.bankChanges.map((c) => (
                <Card key={c.id} className="flex flex-col gap-2 p-5 text-[15px]">
                  <div>
                    <b>{c.id}</b> · {c.channel.replace(/_/g, " ")} · {formatDate(c.requestedAt)} · account {c.oldLast4} → {c.newLast4} · asked by {name(c.requestedById)}
                  </div>
                  <div className={c.status === "pending" ? "form-error" : "muted"}>
                    {c.status === "pending"
                      ? "Not verified: every payment to this vendor is held until a second person calls back."
                      : `${c.status} by ${name(c.verifiedById)}${c.verifiedByCallback ? " after a callback" : ""}${c.note ? `: ${c.note}` : ""}`}
                  </div>
                  {c.status === "pending" && canDecide && <BankChangeDecision slug={org.slug} changeId={c.id} />}
                </Card>
              ))}
            </div>
          ) : (
            <p className="muted">No bank changes.</p>
          )}
          {roleCan(user.role, "vendor.bank_change.request") && (
            <div className="mt-4 max-w-[640px]">
              <BankChangeForm slug={org.slug} vendorId={v.id} />
            </div>
          )}
        </section>
      )}

      <section className="mt-10">
        <SectionHeading id="spend" level={3}>AP invoices and card charges</SectionHeading>
        <TableCard label="Invoices and card charges" minWidth={640}>
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th>Status / source</th>
              <th className="amt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...data.invoices.map((i) => ({ key: i.id, date: i.invoiceDate, what: <Link href={`/invoices/${i.id}`}>{i.id} · {i.invoiceNumber ?? "no number"}</Link>, status: i.status, amount: formatMoney(i.total, i.currency) })),
              ...data.cardCharges.map((c) => ({ key: c.id, date: c.postedDate, what: <span>{c.id} · card {c.cardId}{c.memo ? ` · ${c.memo}` : ""}</span>, status: c.source.replace(/_/g, " "), amount: formatMoney(c.amount, c.currency) })),
            ]
              .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
              .map((r) => (
                <tr key={r.key}>
                  <td className="num">{r.date ? formatDate(r.date) : "—"}</td>
                  <td>{r.what}</td>
                  <td>{r.status}</td>
                  <td className="amt">{r.amount}</td>
                </tr>
              ))}
          </tbody>
        </TableCard>
      </section>
    </>
  );
}
