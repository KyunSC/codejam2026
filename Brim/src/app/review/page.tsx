import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, EmptyState, PrimaryCell, SectionHeading, StatRow, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { formatDate, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/invoices/labels";
import { reviewQueue } from "@/lib/workflow/queues";

const EMAIL_LABEL: Record<string, string> = {
  missing_attachment: "Says an invoice is attached, but nothing is",
  statement: "Statement of account",
  payment_inquiry: "Asks about a payment",
  other: "Not an invoice",
};

export default function ReviewPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading the queue…</p>}>
        <ReviewView />
      </Suspense>
    </main>
  );
}

async function ReviewView() {
  const { user, org } = await requireUser();
  if (!roleCan(user.role, "invoice.edit")) redirect("/");
  const { invoices, emails } = await reviewQueue(org.id);
  const held = invoices.filter((i) => i.flags.some((f) => f.effect === "hold"));
  const ready = invoices.filter((i) => i.status === "coded");

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Review queue</h1>
      <p className="muted m-0 mb-8 max-w-[64ch] text-[15px]">
        Invoices still in review, the ones a check is holding first. Open one to fix fields, resolve flags, accept coding
        and submit it for approval.
      </p>
      <StatRow
        label="Queue"
        stats={[
          { label: "Held by a check", value: held.length, alert: held.length > 0 },
          { label: "Ready to submit", value: ready.length },
          { label: "In review", value: invoices.length },
          { label: "Emails needing attention", value: emails.length, alert: emails.length > 0 },
        ]}
      />

      <section className="mt-10">
        <SectionHeading id="queue" level={3}>Invoices</SectionHeading>
        {invoices.length === 0 ? (
          <EmptyState title="Nothing to review">New inbox invoices appear here once read.</EmptyState>
        ) : (
          <TableCard label="Review queue" minWidth={860}>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Received</th>
                <th className="amt">Total</th>
                <th>Status</th>
                <th>Open flags</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/invoices/${i.id}`} className="no-underline">
                      <PrimaryCell title={i.vendorName ?? i.document?.fileName ?? i.id} detail={`${i.id} · ${i.invoiceNumber ?? i.document?.fileName ?? ""}`} />
                    </Link>
                  </td>
                  <td className="num">{formatDate(i.receivedDate)}</td>
                  <td className="amt">{formatMoney(i.total, i.currency)}</td>
                  <td>{statusLabel(i.status)}</td>
                  <td className="text-sm">
                    {i.flags.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      i.flags.map((f) => (
                        <span key={f.code} className={`mr-1.5 inline-block ${f.effect === "hold" ? "form-error" : "muted"}`}>
                          {f.code.toLowerCase().replace(/_/g, " ")}
                          {f.effect === "hold" ? " (holds)" : ""}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </section>

      <section className="mt-10">
        <SectionHeading id="attention" level={3}>Inbox: needs attention</SectionHeading>
        {emails.length === 0 ? (
          <p className="muted">No emails waiting.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {emails.map((e) => (
              <Card key={e.id} className="p-5 text-[15px]">
                <div>
                  <b>{e.label ? EMAIL_LABEL[e.label] ?? e.label : "Could not be labelled"}</b>
                  <span className="muted"> · {e.fromName} &lt;{e.fromAddress}&gt; · {formatDate(e.receivedAt)}</span>
                </div>
                <div className="mt-1">{e.subject}</div>
                {e.labelReason && <div className="muted mt-1 text-sm">{e.labelReason}</div>}
                {e.linkedInvoiceId && (
                  <div className="mt-1 text-sm">
                    About <Link href={`/invoices/${e.linkedInvoiceId}`}>{e.linkedInvoiceId}</Link>
                  </div>
                )}
                {e.linkedVendorId && !e.linkedInvoiceId && (
                  <div className="mt-1 text-sm">
                    From <Link href={`/vendors/${e.linkedVendorId}`}>{e.linkedVendorId}</Link>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
