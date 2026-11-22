import { Fragment } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { getInvoiceRecord, InvoiceRow, PaymentRow } from "@/services/read.service";
import { get, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm } from "../components/ApiForm";
import { DataTable, type Column } from "../components/DataTable";
import { FilterStar } from "../customize/FilterStar";
import { HiddenTray } from "../customize/HiddenTray";
import { HideButton } from "../customize/HideButton";
import { setVisible } from "../customize/lists";
import { usePreferences } from "../preferences";
import { A, Card, NotFound, PAGE_SIZE, PageTitle, Pager, Show, Status, Table, Td, btn, date, dateTime, pageParam, withParams } from "../components/ui";

const TABS = ["scheduled", "released", "outstanding", "settled", "all"];

// The payments table's columns (ids and labels in TABLES.payments, src/lib/preferences.ts).
const PAYMENT_COLUMNS: Column<PaymentRow>[] = [
  { id: "id", render: (p) => <A href={`/payments/${p.payment_id}`}>{p.payment_id}</A> },
  { id: "invoice", render: (p) => <A href={`/invoices/${p.invoice_id}`}>{p.invoice_id}</A> },
  { id: "vendor", render: (p) => p.vendor },
  { id: "method", render: (p) => p.method },
  { id: "amount", className: "whitespace-nowrap", render: (p) => money(p.amount, p.currency) },
  { id: "scheduled", render: (p) => date(p.scheduled_date) },
  { id: "paid", render: (p) => date(p.paid_date) },
  { id: "prepared_released", className: "text-xs", render: (p) => <>{p.preparer ?? "—"} / {p.releaser ?? "—"}</> },
  { id: "status", render: (p) => <Status value={p.status} /> },
];

export function Payments() {
  const user = useUser();
  const [sp] = useSearchParams();
  const { prefs, update } = usePreferences();
  // "Ready to pay" can be hidden (plan 6.8, in place of the totals row this page no longer has); the list is locked.
  // A hidden section isn't fetched.
  const sections = prefs.sections.payments;
  const showReady = sections.some((x) => x.id === "ready" && x.visible);
  const sectionPath = { kind: "section", page: "payments" } as const;
  // The filter in the URL wins; without one, the list opens on the user's default (plan 6.6).
  const status = TABS.includes(sp.get("status") ?? "") ? sp.get("status")! : (prefs.tables.payments.filter ?? "scheduled");
  const page = pageParam(sp.get("page"));
  const readyPage = pageParam(sp.get("readyPage"));
  const rows = useLoad(() => get<PaymentRow[]>(org(user, `/payments${qs({ status: status === "all" ? null : status, page, size: PAGE_SIZE })}`)), `${status}:${page}`);
  // approved invoices with no payment yet, for the clerk to prepare
  const ready = useLoad(
    () => (can(user, "payment.prepare") && showReady
      ? get<InvoiceRow[]>(org(user, `/invoices${qs({ status: "approved", type: "invoice", page: readyPage, size: PAGE_SIZE })}`))
      : Promise.resolve([] as InvoiceRow[])),
    `${showReady}:${readyPage}`,
  );
  if (!can(user, "payment.view")) return <NotFound />;

  const release = (id: string) => async () => {
    await post(org(user, `/payments/${id}/release`));
    rows.reload();
    return "Released.";
  };
  const prepare = (invoiceId: string) => async () => {
    await post(org(user, "/payments"), { invoice_id: invoiceId });
    rows.reload();
    ready.reload();
    return "Scheduled.";
  };

  return (
    <div className="space-y-5">
      <PageTitle sub="The AP clerk prepares payments for approved invoices; the payment policies say who may release them; a payment settles when the bank statement shows it.">Payments</PageTitle>
      {can(user, "payment.prepare") && (ready.data?.length ?? 0) > 0 && (
        <Card id="ready" title={`${ready.data![0].total_count} ready to pay`} actions={<HideButton label="the Ready to pay section" onHide={() => update(setVisible(sectionPath, sections, "ready", false))} />}>
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
          <Pager param="readyPage" page={readyPage} total={ready.data![0].total_count} />
        </Card>
      )}
      <HiddenTray what="sections" items={sections} onShow={(id) => update(setVisible(sectionPath, sections, id, true))} />
      <Card
        id="payments"
        title={`${rows.data?.[0]?.total_count ?? 0} payments`}
        actions={
          <>
            {TABS.map((s) => (
              <Fragment key={s}>
                <Link to={withParams(sp, { status: s, page: null })} className="chip" aria-current={s === status}>{s}</Link>
                <FilterStar table="payments" value={s} label={s} to={withParams(sp, { status: s, page: null })} />
              </Fragment>
            ))}
          </>
        }
      >
        <Show load={rows}>
          {(list) => (
            <>
              <DataTable
                table="payments"
                rows={list}
                rowKey={(p) => p.payment_id}
                columns={PAYMENT_COLUMNS}
                trailing={(p) => (
                  <>
                    {p.can_release && <ApiForm submit={release(p.payment_id)} confirm={`Release ${money(p.amount, p.currency)} to ${p.vendor}?`}><button className={btn}>Release</button></ApiForm>}
                    {p.release_blocked && <span className="text-xs muted">{p.release_blocked}</span>}
                  </>
                )}
                empty="No payments."
              />
              <Pager param="page" page={page} total={list[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>
    </div>
  );
}

type PaymentView = { p: PaymentRow & { statement: { posted_date: string; description: string; amount: number } | null }; inv: Awaited<ReturnType<typeof getInvoiceRecord>>; gl: { account_number: string; name: string }[] };

// Audit-ready view: payment → bank account paid → invoice → approval chain → accounting codes.
export function Payment() {
  const user = useUser();
  const { id = "" } = useParams();
  const load = useLoad(async (): Promise<PaymentView> => {
    const p = await get<PaymentView["p"]>(org(user, `/payments/${id}`));
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
              <Card title="Payment" actions={p.can_release ? <ApiForm inline submit={release} confirm={`Release ${money(p.amount, p.currency)} to ${p.vendor}?`}><button className={btn}>Release</button></ApiForm> : p.release_blocked && <span className="text-xs muted">{p.release_blocked}</span>}>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="muted">Method</dt><dd>{p.method}</dd>
                  <dt className="muted">Amount</dt><dd>{money(p.amount, p.currency)}{p.currency !== "CAD" && ` = ${money(p.amount_cad)} at ${p.fx_rate_to_cad}`}</dd>
                  <dt className="muted">Scheduled</dt><dd>{date(p.scheduled_date)}</dd>
                  <dt className="muted">Prepared by</dt><dd>{p.preparer ?? "—"}</dd>
                  <dt className="muted">Released by</dt><dd>{p.releaser ?? "—"} {p.released_at && `· ${dateTime(p.released_at)}`}</dd>
                  <dt className="muted">Paid</dt><dd>{date(p.paid_date)}</dd>
                  <dt className="muted">Bank account paid</dt><dd>{p.snapshot_account ? `${p.snapshot_institution}-${p.snapshot_transit}-${p.snapshot_account}` : "—"}</dd>
                  <dt className="muted">Reference</dt><dd className="font-mono text-xs">{p.bank_reference ?? p.card_reference ?? "—"}</dd>
                  {p.cheque_number && <><dt className="muted">Cheque</dt><dd>{p.cheque_number}</dd></>}
                  <dt className="muted">Statement line</dt>
                  <dd>{p.statement ? <>{date(p.statement.posted_date)} · <span className="font-mono text-xs">{p.statement.description}</span> · {money(p.statement.amount)}</> : "—"}</dd>
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
