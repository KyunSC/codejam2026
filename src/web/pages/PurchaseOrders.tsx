import { Link, useParams, useSearchParams } from "react-router-dom";
import { money } from "@/lib/format";
import type { InvoiceRow } from "@/services/read.service";
import { get, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { A, Card, PAGE_SIZE, PageTitle, Pager, Show, Status, Table, Td, date, pageParam } from "../components/ui";

// A purchase order as the records endpoint returns it, with the values it shows alongside
type PurchaseOrderRow = {
  po_id: string; vendor_id: string; vendor_name: string; department: string | null; requester: string | null; approver: string | null;
  issue_date: string | null; description: string | null; total_amount: number; currency: string; status: string; billed: number; total_count: number;
};

const TABS = ["open", "partially_invoiced", "closed", "all"];

// What is left on an order; below zero means invoices billed more than it allowed.
const Remaining = ({ value }: { value: number }) => <span className={value < 0 ? "font-bold text-flag" : ""}>{money(value)}</span>;

export function PurchaseOrders() {
  const user = useUser();
  const [sp] = useSearchParams();
  const status = TABS.includes(sp.get("status") ?? "") ? sp.get("status")! : "open";
  const page = pageParam(sp.get("page"));
  const load = useLoad(
    () => get<PurchaseOrderRow[]>(org(user, `/purchase-orders${qs({ status: status === "all" ? null : status, page, size: PAGE_SIZE })}`)),
    `${status}:${page}`,
  );
  return (
    <div className="space-y-5">
      <PageTitle>Purchase orders</PageTitle>
      <Card
        title={`${load.data?.[0]?.total_count ?? 0} purchase orders`}
        actions={TABS.map((s) => (
          <Link key={s} to={`/purchase-orders?status=${s}`} className="chip" aria-current={s === status}>{s.replace(/_/g, " ")}</Link>
        ))}
      >
        <Show load={load}>
          {(rows) => (
            <>
              <Table head={["Purchase order", "Vendor", "Department", "Description", "Total", "Billed", "Remaining", "Issued", "Status"]} empty="No purchase orders.">
                {rows.map((p) => (
                  <tr key={p.po_id}>
                    <Td className="whitespace-nowrap"><A href={`/purchase-orders/${p.po_id}`}>{p.po_id}</A></Td>
                    <Td><A href={`/vendors/${p.vendor_id}`}>{p.vendor_name}</A></Td>
                    <Td>{p.department ?? "—"}</Td>
                    <Td>{p.description}</Td>
                    <Td className="whitespace-nowrap">{money(p.total_amount)}</Td>
                    <Td className="whitespace-nowrap">{money(p.billed)}</Td>
                    <Td className="whitespace-nowrap"><Remaining value={p.total_amount - p.billed} /></Td>
                    <Td className="whitespace-nowrap">{date(p.issue_date)}</Td>
                    <Td><Status value={p.status} /></Td>
                  </tr>
                ))}
              </Table>
              <Pager param="page" page={page} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>
    </div>
  );
}

export function PurchaseOrder() {
  const user = useUser();
  const { id } = useParams();
  const load = useLoad(async () => {
    const [po, invoices] = await Promise.all([get<PurchaseOrderRow>(org(user, `/purchase-orders/${id}`)), get<InvoiceRow[]>(org(user, `/invoices${qs({ po_id: id, size: 300 })}`))]);
    return { po, invoices };
  }, id ?? "");
  return (
    <Show load={load}>
      {({ po: p, invoices }) => (
        <div className="space-y-5">
          <PageTitle sub={<Status value={p.status} />}>{p.po_id} · {p.vendor_name}</PageTitle>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Details">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="muted">Vendor</dt><dd><A href={`/vendors/${p.vendor_id}`}>{p.vendor_name}</A></dd>
                <dt className="muted">Description</dt><dd>{p.description ?? "—"}</dd>
                <dt className="muted">Department</dt><dd>{p.department ?? "—"}</dd>
                <dt className="muted">Requester</dt><dd>{p.requester ?? "—"}</dd>
                <dt className="muted">Approved by</dt><dd>{p.approver ?? "—"}</dd>
                <dt className="muted">Issued</dt><dd>{date(p.issue_date)}</dd>
                <dt className="muted">Total</dt><dd>{money(p.total_amount, p.currency)}</dd>
                <dt className="muted">Billed</dt><dd>{money(p.billed, p.currency)}</dd>
                <dt className="muted">Remaining</dt><dd><Remaining value={p.total_amount - p.billed} /></dd>
              </dl>
            </Card>
            <Card title={`Invoices (${invoices.length})`}>
              <Table head={["Invoice", "Number", "Date", "Total", "Status"]} empty="No invoices.">
                {invoices.map((i) => (
                  <tr key={i.invoice_id}>
                    <Td><A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A></Td>
                    <Td>{i.vendor_invoice_number}</Td>
                    <Td>{date(i.invoice_date)}</Td>
                    <Td>{money(i.total, i.currency)}</Td>
                    <Td><Status value={i.status} /></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </Show>
  );
}
