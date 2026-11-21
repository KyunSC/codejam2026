import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PrimaryCell, StatRow, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { formatDate, formatMoney, param } from "@/lib/format";
import { BUCKET_LABEL, BUCKETS, type Bucket, paymentsDashboard } from "@/lib/workflow/payment-queries";
import { BankRunButton, PrepareButton, ReleaseButton } from "./payment-actions";

type SP = Promise<Record<string, string | string[] | undefined>>;

const READERS = ["ap_clerk", "finance_manager", "controller_admin", "auditor"];

export default function PaymentsPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading payments…</p>}>
        <PaymentsView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const money = (byCurrency: Record<string, string>) =>
  Object.entries(byCurrency).length ? Object.entries(byCurrency).map(([c, v]) => formatMoney(v, c)).join(" + ") : "—";

async function PaymentsView({ searchParams }: { searchParams: SP }) {
  const { user, org } = await requireUser();
  if (!READERS.includes(user.role)) redirect("/invoices");
  const sp = await searchParams;
  const requested = param(sp.bucket);
  const canPrepare = roleCan(user.role, "payment.prepare");
  const canRelease = roleCan(user.role, "payment.release");
  const canRun = ["ap_clerk", "finance_manager", "controller_admin"].includes(user.role);
  const defaultBucket: Bucket = canRelease ? "awaiting_release" : canPrepare ? "ready" : "awaiting_release";
  const bucket = (BUCKETS as readonly string[]).includes(requested) ? (requested as Bucket) : defaultBucket;
  const data = await paymentsDashboard(org.id, bucket);
  const held = data.rows.filter((r) => r.blockers.length > 0);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label muted m-0 mb-3 text-sm">{org.name} · today is {formatDate(data.today)}</p>
          <h1 className="heading m-0 text-[40px] leading-[.95] sm:text-[56px]">Payments</h1>
          <p className="muted m-0 mt-3 max-w-[64ch] text-[15px]">
            Approved invoices become scheduled payments (AP clerk). A finance manager (up to $100,000) or a controller
            releases them, never someone who approved the invoice. The bank run then sends them.
          </p>
        </div>
        {canRun && <BankRunButton slug={org.slug} />}
      </div>

      <StatRow
        label="Payments by bucket"
        stats={[
          { label: "Awaiting release", value: data.totals.awaiting_release.count },
          { label: "Overdue", value: data.totals.overdue.count, alert: data.totals.overdue.count > 0 },
          { label: "Due this week", value: data.totals.due_this_week.count },
          { label: "Failed", value: data.totals.failed.count, alert: data.totals.failed.count > 0 },
        ]}
      />

      <nav aria-label="Buckets" className="mt-8 mb-6 flex flex-wrap gap-2">
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={`/payments?bucket=${b}`}
            aria-current={b === bucket ? "page" : undefined}
            className={`chip no-underline ${b === bucket ? "chip--check" : ""}`}
          >
            {BUCKET_LABEL[b]} <span className="num">{data.totals[b].count}</span>
            <span className="muted ml-1.5 text-xs">{money(data.totals[b].byCurrency)}</span>
          </Link>
        ))}
      </nav>

      {held.length > 0 && (
        <p className="form-error mb-4">
          {held.length} {held.length === 1 ? "payment is" : "payments are"} held in this bucket. Each one says why below.
        </p>
      )}

      {data.rows.length === 0 ? (
        <EmptyState title={`Nothing ${BUCKET_LABEL[bucket].toLowerCase()}`}>Payments move between buckets as they are prepared, released and sent.</EmptyState>
      ) : (
        <TableCard label={BUCKET_LABEL[bucket]} minWidth={980}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Method</th>
              <th>Date</th>
              <th className="amt">Amount</th>
              <th>Who may release</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.paymentId ?? r.invoiceId}>
                <td>
                  <Link href={`/invoices/${r.invoiceId}`} className="no-underline">
                    <PrimaryCell title={r.vendorName ?? r.invoiceId} detail={`${r.invoiceId}${r.paymentId ? ` · ${r.paymentId}` : ""}`} />
                  </Link>
                </td>
                <td>{r.method ?? "—"}</td>
                <td className="num">{r.date ? formatDate(r.date) : "—"}</td>
                <td className="amt">
                  {formatMoney(r.amount, r.currency)}
                  {r.currency !== "CAD" && <span className="muted block text-sm">{formatMoney(r.amountCad, "CAD")}</span>}
                </td>
                <td className="text-sm">
                  {r.releaseBlocked ? (
                    <span className="form-error">{r.releaseBlocked}</span>
                  ) : r.releasers.length ? (
                    r.releasers.join(", ")
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="text-sm">
                  {r.status.replace("_", " ")}
                  {r.blockers.map((b) => (
                    <span key={b.code} className="form-error mt-1 block">
                      {b.message}
                    </span>
                  ))}
                  {r.failureReason && <span className="form-error mt-1 block">{r.failureReason}</span>}
                </td>
                <td>
                  {r.kind === "invoice" && canPrepare && r.blockers.length === 0 && <PrepareButton slug={org.slug} invoiceId={r.invoiceId} />}
                  {r.kind === "payment" && r.status === "scheduled" && canRelease && r.blockers.length === 0 && (
                    <ReleaseButton slug={org.slug} paymentId={r.paymentId!} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
