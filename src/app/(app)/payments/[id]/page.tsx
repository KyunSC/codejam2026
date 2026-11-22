import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { one, query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Card, PageTitle, Status, Table, Td, btn, date, dateTime, money } from "@/components/ui";
import { releaseAction } from "../../../actions";
import type { InvoiceLine } from "@/lib/types";

// Audit-ready view: payment → bank account paid → invoice → approval chain → accounting codes.
export default async function PaymentPage({ params }: PageProps<"/payments/[id]">) {
  const user = await requireUser();
  if (!can(user, "payment.view")) notFound();
  const { id } = await params;
  const p = await one<{
    payment_id: string; invoice_id: string; vendor_id: string; vendor: string; method: string; amount: number; currency: string; amount_cad: number; fx_rate_to_cad: number;
    scheduled_date: string | null; paid_date: string | null; status: string; preparer: string | null; releaser: string | null; released_at: string | null;
    snapshot_institution: string | null; snapshot_transit: string | null; snapshot_account: string | null; bank_reference: string | null; card_reference: string | null; discount_taken: number;
  }>(
    `SELECT p.*, v.legal_name vendor, u1.full_name preparer, u2.full_name releaser FROM payments p JOIN vendors v USING (vendor_id)
       LEFT JOIN users u1 ON u1.user_id=p.prepared_by LEFT JOIN users u2 ON u2.user_id=p.released_by WHERE p.payment_id=$1 AND p.organization_id=$2`,
    [id, user.organization_id],
  );
  if (!p) notFound();
  const inv = (await one<{ invoice_id: string; vendor_invoice_number: string; invoice_date: string; total: number; currency: string; gst_hst_amount: number; pst_qst_amount: number; lines: InvoiceLine[]; requester: string | null; status: string }>(
    "SELECT i.*, u.full_name requester FROM invoices i LEFT JOIN users u ON u.user_id=i.requester_user_id WHERE invoice_id=$1",
    [p.invoice_id],
  ))!;
  const steps = await query<{ step_no: number; actor: string | null; on_behalf: string | null; status: string; acted_at: string | null; comment: string | null }>(
    `SELECT a.step_no, u.full_name actor, ob.full_name on_behalf, a.status, a.acted_at, a.comment FROM approvals a
       LEFT JOIN users u ON u.user_id=a.acted_by LEFT JOIN users ob ON ob.user_id=a.on_behalf_of_user_id WHERE a.invoice_id=$1 ORDER BY a.step_no`,
    [p.invoice_id],
  );
  const gl = await query<{ account_number: string; name: string }>("SELECT account_number, name FROM gl_accounts WHERE organization_id=$1", [user.organization_id]);
  const glName = (n: string | null | undefined) => gl.find((g) => g.account_number === n)?.name ?? "";

  return (
    <div className="space-y-5">
      <PageTitle sub={<Status value={p.status} />}>{p.payment_id} · {p.vendor} · {money(p.amount, p.currency)}</PageTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Payment" actions={p.status === "scheduled" && can(user, "payment.release") && <ActionForm action={releaseAction.bind(null, p.payment_id)}><button className={btn}>Release</button></ActionForm>}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="muted">Method</dt><dd>{p.method}</dd>
            <dt className="muted">Amount</dt><dd>{money(p.amount, p.currency)}{p.currency !== "CAD" && ` = ${money(p.amount_cad)} at ${p.fx_rate_to_cad}`}</dd>
            <dt className="muted">Scheduled</dt><dd>{date(p.scheduled_date)}</dd>
            <dt className="muted">Prepared by</dt><dd>{p.preparer ?? "—"}</dd>
            <dt className="muted">Released by</dt><dd>{p.releaser ?? "—"} {p.released_at && `· ${dateTime(p.released_at)}`}</dd>
            <dt className="muted">Paid</dt><dd>{date(p.paid_date)}</dd>
            <dt className="muted">Bank account paid</dt><dd>{p.snapshot_account ? `${p.snapshot_institution}-${p.snapshot_transit}-${p.snapshot_account}` : "—"}</dd>
            <dt className="muted">Reference</dt><dd className="font-mono text-xs">{p.bank_reference ?? p.card_reference ?? "—"}</dd>
          </dl>
        </Card>
        <Card title="Invoice">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="muted">Invoice</dt><dd><A href={`/invoices/${inv.invoice_id}`}>{inv.invoice_id}</A> ({inv.vendor_invoice_number})</dd>
            <dt className="muted">Date</dt><dd>{date(inv.invoice_date)}</dd>
            <dt className="muted">Requester</dt><dd>{inv.requester ?? "—"}</dd>
            <dt className="muted">Total</dt><dd>{money(inv.total, inv.currency)}</dd>
          </dl>
        </Card>
        <Card title="Approval chain">
          <Table head={["Step", "Approved by", "Status", "When"]}>
            {steps.map((s) => (
              <tr key={s.step_no}><Td>{s.step_no}</Td><Td>{s.actor ?? "—"}{s.on_behalf && ` on behalf of ${s.on_behalf}`}</Td><Td><Status value={s.status} /></Td><Td>{dateTime(s.acted_at)}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Accounting codes">
          <Table head={["Line", "Description", "GL account", "Amount"]}>
            {inv.lines.map((l) => (
              <tr key={l.line_no}><Td>{l.line_no}</Td><Td>{l.description}</Td><Td>{l.gl_account} {glName(l.gl_account)}</Td><Td>{money(l.amount, inv.currency)}</Td></tr>
            ))}
            {inv.gst_hst_amount !== 0 && <tr><Td /><Td>GST/HST recoverable</Td><Td>1160 {glName("1160")}</Td><Td>{money(inv.gst_hst_amount, inv.currency)}</Td></tr>}
            {inv.pst_qst_amount !== 0 && <tr><Td /><Td>PST/QST</Td><Td>{inv.lines.some((l) => l.pst_qst_code === "QST9975") ? `1165 ${glName("1165")}` : "expensed with the lines"}</Td><Td>{money(inv.pst_qst_amount, inv.currency)}</Td></tr>}
          </Table>
        </Card>
      </div>
    </div>
  );
}
