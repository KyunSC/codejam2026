import { Link, useParams, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { getInvoiceRecord, InvoiceRow, PaymentRow } from "@/services/read.service";
import { get, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm } from "../components/ApiForm";
import { A, Card, NotFound, PageTitle, Show, Status, Table, Td, btn, btnLight, date, dateTime } from "../components/ui";

const TABS = ["scheduled", "released", "outstanding", "settled", "all"];

export function Payments() {
  const user = useUser();
  const [sp] = useSearchParams();
  const tab = TABS.includes(sp.get("status") ?? "") ? sp.get("status")! : "scheduled";
  const totals = useLoad(() => get<{ status: string; n: number; total: number }[]>(org(user, "/payments/totals")), "");
  const rows = useLoad(() => get<PaymentRow[]>(org(user, `/payments${qs({ status: tab === "all" ? null : tab, size: 300 })}`)), tab);
  // approved invoices with no payment yet, for the clerk to prepare
  const ready = useLoad(
    () => (can(user, "payment.prepare") ? get<InvoiceRow[]>(org(user, "/invoices?status=approved&type=invoice&size=100")) : Promise.resolve([] as InvoiceRow[])),
    "",
  );
  if (!can(user, "payment.view")) return <NotFound />;

  const release = (id: string) => async () => {
    await post(org(user, `/payments/${id}/release`));
    totals.reload();
    rows.reload();
    return "Released.";
  };
  const prepare = (invoiceId: string) => async () => {
    await post(org(user, "/payments"), { invoice_id: invoiceId });
    totals.reload();
    rows.reload();
    ready.reload();
    return "Scheduled.";
  };
  const simulate = async () => {
    const r = await post<{ sent: number; waiting: number }>(org(user, "/bank-runs"));
    totals.reload();
    rows.reload();
    return `${r.sent} payment${r.sent === 1 ? "" : "s"} sent to the bank.${r.waiting ? ` ${r.waiting} released payment${r.waiting === 1 ? " waits" : "s wait"} for the scheduled date.` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageTitle sub="The AP clerk prepares payments for approved invoices; the finance manager (up to $100,000) or the controller releases them; the bank simulation sends released payments.">Payments</PageTitle>
      <div className="grid gap-4 sm:grid-cols-4">
        {["scheduled", "released", "outstanding", "settled"].map((s) => {
          const t = totals.data?.find((x) => x.status === s);
          return (
            <Link key={s} to={`/payments?status=${s}`} className="card p-4" style={tab === s ? ({ "--card-shadow": "var(--red)" } as React.CSSProperties) : undefined}>
              <div className="heading num text-4xl leading-none">{t?.n ?? 0}</div>
              <div className="label muted mt-2 text-xs">{s} · {money(t?.total ?? 0)}</div>
            </Link>
          );
        })}
      </div>
      {can(user, "payment.prepare") && (ready.data?.length ?? 0) > 0 && (
        <Card title={`Ready to pay (${ready.data!.length})`}>
          <Table head={["Invoice", "Vendor", "Invoice #", "Due", "Total", ""]}>
            {ready.data!.map((i) => (
              <tr key={i.invoice_id}>
                <Td><A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A></Td>
                <Td>{i.vendor_name}</Td>
                <Td>{i.vendor_invoice_number}</Td>
                <Td>{date(i.due_date)}</Td>
                <Td className="whitespace-nowrap">{money(i.total, i.currency)}</Td>
                <Td><ApiForm inline submit={prepare(i.invoice_id)}><button className={btn}>Prepare payment</button></ApiForm></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card
        title={`Payments: ${tab}`}
        actions={
          <>
            <Link to="/payments?status=all" className="text-xs link">all</Link>
            {can(user, "payment.simulate") && <ApiForm inline submit={simulate}><button className={btnLight}>Run bank simulation</button></ApiForm>}
          </>
        }
      >
        <Show load={rows}>
          {(list) => (
            <Table head={["Payment", "Invoice", "Vendor", "Method", "Amount", "Scheduled", "Paid", "Prepared / released", "Status", ""]} empty="No payments.">
              {list.map((p) => (
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
                    {p.can_release && <ApiForm submit={release(p.payment_id)}><button className={btn}>Release</button></ApiForm>}
                    {p.release_blocked && <span className="text-xs muted">{p.release_blocked}</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Show>
      </Card>
    </div>
  );
}

type PaymentView = { p: PaymentRow; inv: Awaited<ReturnType<typeof getInvoiceRecord>>; gl: { account_number: string; name: string }[] };

// Audit-ready view: payment → bank account paid → invoice → approval chain → accounting codes.
export function Payment() {
  const user = useUser();
  const { id = "" } = useParams();
  const load = useLoad(async (): Promise<PaymentView> => {
    const p = await get<PaymentRow>(org(user, `/payments/${id}`));
    const [inv, gl] = await Promise.all([get<PaymentView["inv"]>(org(user, `/invoices/${p.invoice_id}`)), get<PaymentView["gl"]>(org(user, "/gl-accounts"))]);
    return { p, inv, gl };
  }, id);
  if (!can(user, "payment.view")) return <NotFound />;
  const release = async () => {
    await post(org(user, `/payments/${id}/release`));
    load.reload();
    return "Released.";
  };

  return (
    <Show load={load}>
      {({ p, inv, gl }) => {
        const glName = (n: string | null | undefined) => gl.find((g) => g.account_number === n)?.name ?? "";
        return (
          <div className="space-y-5">
            <PageTitle sub={<Status value={p.status} />}>{p.payment_id} · {p.vendor} · {money(p.amount, p.currency)}</PageTitle>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Payment" actions={p.can_release ? <ApiForm inline submit={release}><button className={btn}>Release</button></ApiForm> : p.release_blocked && <span className="text-xs muted">{p.release_blocked}</span>}>
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
                  {inv.approvals.map((s) => (
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
      }}
    </Show>
  );
}
