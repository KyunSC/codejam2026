import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Card, PageTitle, Status, Table, Td, btn, btnLight, date, money } from "@/components/ui";
import { releaseAction, simulateAction } from "../../actions";

const TABS = ["scheduled", "released", "outstanding", "settled", "all"];

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const user = await requireUser();
  if (!can(user, "payment.view")) notFound();
  const sp = await searchParams;
  const tab = typeof sp.status === "string" && TABS.includes(sp.status) ? sp.status : "scheduled";
  const totals = await query<{ status: string; n: number; total: number }>(
    "SELECT status, count(*)::int n, sum(amount_cad)::float total FROM payments WHERE organization_id=$1 GROUP BY status",
    [user.organization_id],
  );
  const rows = await query<{ payment_id: string; invoice_id: string; vendor: string; method: string; amount: number; currency: string; amount_cad: number; scheduled_date: string | null; paid_date: string | null; status: string; preparer: string | null; releaser: string | null }>(
    `SELECT p.*, v.legal_name vendor, u1.full_name preparer, u2.full_name releaser FROM payments p JOIN vendors v USING (vendor_id)
       LEFT JOIN users u1 ON u1.user_id=p.prepared_by LEFT JOIN users u2 ON u2.user_id=p.released_by
     WHERE p.organization_id=$1 ${tab === "all" ? "" : "AND p.status=$2"} ORDER BY p.scheduled_date DESC NULLS LAST, p.payment_id DESC LIMIT 300`,
    tab === "all" ? [user.organization_id] : [user.organization_id, tab],
  );
  return (
    <div className="space-y-6">
      <PageTitle sub="The AP clerk prepares payments for approved invoices; the finance manager (up to $100,000) or the controller releases them; the bank simulation sends released payments.">Payments</PageTitle>
      <div className="grid gap-4 sm:grid-cols-4">
        {["scheduled", "released", "outstanding", "settled"].map((s) => {
          const t = totals.find((x) => x.status === s);
          return (
            <Link key={s} href={`/payments?status=${s}`} scroll={false} className="card p-4" style={tab === s ? ({ "--card-shadow": "var(--red)" } as React.CSSProperties) : undefined}>
              <div className="heading num text-4xl leading-none">{t?.n ?? 0}</div>
              <div className="label muted mt-2 text-xs">{s} · {money(t?.total ?? 0)}</div>
            </Link>
          );
        })}
      </div>
      <Card
        title={`Payments: ${tab}`}
        actions={
          <>
            <Link href="/payments?status=all" scroll={false} className="text-xs link">all</Link>
            {can(user, "payment.simulate") && <ActionForm action={simulateAction}><button className={btnLight}>Run bank simulation</button></ActionForm>}
          </>
        }
      >
        <Table head={["Payment", "Invoice", "Vendor", "Method", "Amount", "Scheduled", "Paid", "Prepared / released", "Status", ""]} empty="No payments.">
          {rows.map((p) => (
            <tr key={p.payment_id}>
              <Td><A href={`/payments/${p.payment_id}`}>{p.payment_id}</A></Td>
              <Td><A href={`/invoices/${p.invoice_id}`}>{p.invoice_id}</A></Td>
              <Td>{p.vendor}</Td>
              <Td>{p.method}</Td>
              <Td className="whitespace-nowrap">{money(p.amount, p.currency)}</Td>
              <Td>{date(p.scheduled_date)}</Td>
              <Td>{date(p.paid_date)}</Td>
              <Td className="text-xs">{p.preparer ?? "—"} / {p.releaser ?? "—"}</Td>
              <Td><Status value={p.status} /></Td>
              <Td>
                {p.status === "scheduled" && can(user, "payment.release") && (
                  <ActionForm action={releaseAction.bind(null, p.payment_id)}><button className={btn}>Release</button></ActionForm>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
