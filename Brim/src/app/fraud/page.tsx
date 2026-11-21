import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, StatRow, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { roleCan } from "@/lib/auth/matrix";
import { fraudWatch, SENDER_CODES } from "@/lib/workflow/fraud";

const cad = (v: string) => Number(v).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const SCOPE: Record<string, string> = { invoice: "Invoice", vendor: "Vendor", payment: "Payment" };

export default function FraudPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading fraud watch…</p>}>
        <FraudView />
      </Suspense>
    </main>
  );
}

async function FraudView() {
  const { user, org } = await requireUser();
  if (!roleCan(user.role, "flag.resolve.fraud")) {
    return <p className="muted">Fraud watch is for the finance manager and the controller.</p>;
  }
  const { rows, totalAtStakeCad, invoicesAtStake, byCode } = await fraudWatch(user);
  const sender = rows.filter((r) => SENDER_CODES.has(r.code)).length;

  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Fraud watch</h1>
      <p className="muted m-0 mb-6 max-w-[70ch] text-[15px]">
        Every open fraud flag on an invoice, a vendor or a payment, largest amount first. While a flag is open, nothing it touches can be prepared or released.
        Open the invoice to confirm the problem or override it with a reason.
      </p>
      <StatRow
        label="Fraud summary"
        stats={[
          { label: "Open fraud flags", value: rows.length, alert: rows.length > 0 },
          { label: "At stake (CAD)", value: cad(totalAtStakeCad), alert: Number(totalAtStakeCad) > 0 },
          { label: "Invoices held", value: invoicesAtStake },
          { label: "Suspicious senders", value: sender, alert: sender > 0 },
        ]}
      />
      {Object.keys(byCode).length > 0 && (
        <p className="muted mt-4 mb-6 text-sm">
          {Object.entries(byCode)
            .sort((a, b) => b[1] - a[1])
            .map(([code, n]) => `${code} ${n}`)
            .join(" · ")}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No open fraud flags">Nothing is held for fraud right now.</EmptyState>
      ) : (
        <TableCard label="Open fraud flags" minWidth={900}>
          <thead>
            <tr>
              <th>Flag</th>
              <th>On</th>
              <th>What we found</th>
              <th>Payments</th>
              <th className="num">At stake</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.flagId}>
                <td>
                  <strong className={SENDER_CODES.has(r.code) ? "form-error" : ""}>{r.code}</strong>
                  <div className="muted text-xs">{SCOPE[r.scope]}</div>
                </td>
                <td>
                  {r.invoice && (
                    <div>
                      <Link href={`/invoices/${r.invoice.id}`}>{r.invoice.id}</Link>
                      <span className="muted text-xs"> {r.invoice.status.replace("_", " ")}</span>
                    </div>
                  )}
                  {r.vendor && (
                    <div>
                      <Link href={`/vendors/${r.vendor.id}`}>{r.vendor.legalName}</Link>
                      {r.vendor.status !== "active" && <span className="form-error text-xs"> {r.vendor.status.replace("_", " ")}</span>}
                    </div>
                  )}
                </td>
                <td className="max-w-[460px] text-sm">
                  {r.message}
                  {r.evidence.length > 0 && (
                    <ul className="muted m-0 mt-1 pl-4 text-xs">
                      {r.evidence.map((e, i) => (
                        <li key={i}>
                          {e.label}: {e.value} <span className="opacity-70">({e.source})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="text-sm">
                  {r.payments.length ? r.payments.map((p) => <div key={p.id}>{p.id} {p.status}</div>) : <span className="muted">none yet</span>}
                </td>
                <td className="num">
                  {cad(r.atStakeCad)}
                  <div className="muted text-xs">{r.atStakeNote}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
