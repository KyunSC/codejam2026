import Link from "next/link";
import { Suspense } from "react";
import { StatRow, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { reconciliation } from "@/lib/workflow/reconciliation";
import { ExplainForm } from "./explain-form";

const money = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("en-CA", { style: "currency", currency: "CAD" }));

export default function ReconciliationPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pt-10 pb-16 sm:px-5">
      <Suspense fallback={<p className="muted">Loading reconciliation…</p>}>
        <ReconciliationView />
      </Suspense>
    </main>
  );
}

function Explained({ e }: { e: { note: string | null; by: string | null } | null }) {
  return e ? <span className="text-sm">Explained by {e.by}: {e.note}</span> : null;
}

async function ReconciliationView() {
  const { user, org } = await requireUser();
  if (!["finance_manager", "controller_admin", "auditor"].includes(user.role)) {
    return <p className="muted">Bank reconciliation is for the finance manager, the controller and the auditor.</p>;
  }
  const r = await reconciliation(user);
  const s = r.summary;
  return (
    <>
      <p className="label muted m-0 mb-3 text-sm">{org.name}</p>
      <h1 className="heading m-0 mb-3 text-[40px] leading-[.95] sm:text-[56px]">Bank reconciliation</h1>
      <p className="muted m-0 mb-6 max-w-[72ch] text-[15px]">
        Statement lines matched to payments in order: EFTs by the last 6 digits of our reference and the amount; cleared cheques by amount, earliest unmatched
        cheque first, never before it was paid; bank fees to account 7010. Anything else needs a person.
      </p>
      <StatRow
        label="Reconciliation summary"
        stats={[
          { label: "Statement lines", value: s.lines },
          { label: "EFT matched", value: s.eft },
          { label: "Cheques matched", value: s.cheques },
          { label: "Bank fees", value: `${s.monthlyFees} monthly + ${s.wireFees} wire` },
          { label: "Unexplained", value: s.unexplained, alert: s.unexplained > 0 },
        ]}
      />

      <h2 className="heading mt-10 mb-3 text-2xl">Needs a person</h2>
      <TableCard label="Unexplained statement lines" minWidth={760}>
        <thead>
          <tr><th>Line</th><th>Date</th><th>Description</th><th className="num">Amount</th><th>Why</th><th /></tr>
        </thead>
        <tbody>
          {r.unexplained.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.postedDate}</td>
              <td>{u.description}</td>
              <td className="num">{money(u.amount)}</td>
              <td className="text-sm">{u.reason}</td>
              <td>{u.explained ? <Explained e={u.explained} /> : r.canExplain ? <ExplainForm slug={org.slug} lineId={u.id} /> : <span className="form-error text-sm">open</span>}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <h2 className="heading mt-10 mb-3 text-2xl">Matched with a difference</h2>
      <TableCard label="Matches with a difference" minWidth={700}>
        <thead>
          <tr><th>Line</th><th>Payment</th><th>Vendor</th><th className="num">Bank</th><th className="num">Ledger</th><th>Note</th></tr>
        </thead>
        <tbody>
          {r.matches.filter((m) => m.note).map((m) => (
            <tr key={m.line.id}>
              <td>{m.line.id} <span className="muted text-xs">{m.line.description}</span></td>
              <td><Link href={`/invoices/${m.payment.invoiceId}`}>{m.payment.id}</Link></td>
              <td>{m.payment.vendorName}</td>
              <td className="num">{money(m.line.amount)}</td>
              <td className="num">{money(m.payment.amount)}</td>
              <td className="text-sm">{m.note}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <h2 className="heading mt-10 mb-3 text-2xl">Payments with no statement line</h2>
      <p className="muted m-0 mb-3 text-sm">Scheduled payments are expected here until the bank run sends them.</p>
      <TableCard label="Payments with no statement line" minWidth={760}>
        <thead>
          <tr><th>Payment</th><th>Vendor</th><th>Method</th><th className="num">Amount</th><th>Why</th><th /></tr>
        </thead>
        <tbody>
          {r.paymentsWithoutLine.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/invoices/${p.invoiceId}`}>{p.id}</Link></td>
              <td>{p.vendorName}</td>
              <td>{p.method}</td>
              <td className="num">{money(p.amount)}</td>
              <td className={p.expected ? "text-sm" : "form-error text-sm"}>{p.reason}</td>
              <td>{p.explained ? <Explained e={p.explained} /> : !p.expected && r.canExplain ? <ExplainForm slug={org.slug} paymentId={p.id} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <h2 className="heading mt-10 mb-3 text-2xl">Cleared by the bank, outstanding in the ledger</h2>
      <p className="muted m-0 mb-3 text-sm">{r.clearedButOutstanding.length} cheques the ledger still calls sent that the bank has cleared.</p>
      <TableCard label="Cleared cheques still outstanding" minWidth={640}>
        <thead>
          <tr><th>Payment</th><th>Vendor</th><th>Paid</th><th>Cleared</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {r.clearedButOutstanding.map((c) => (
            <tr key={c.payment.id}>
              <td><Link href={`/invoices/${c.payment.invoiceId}`}>{c.payment.id}</Link></td>
              <td>{c.payment.vendorName}</td>
              <td>{c.payment.paidDate}</td>
              <td>{c.line.postedDate} <span className="muted text-xs">{c.line.description}</span></td>
              <td className="num">{money(c.payment.amount)}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <h2 className="heading mt-10 mb-3 text-2xl">Bank fees</h2>
      <TableCard label="Bank fees" minWidth={520}>
        <thead>
          <tr><th>Line</th><th>Date</th><th>Description</th><th>Account</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {r.fees.map((f) => (
            <tr key={f.id}><td>{f.id}</td><td>{f.postedDate}</td><td>{f.description}</td><td>{f.account}</td><td className="num">{money(f.amount)}</td></tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
