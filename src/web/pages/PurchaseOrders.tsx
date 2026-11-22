import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { InvoiceRow } from "@/services/read.service";
import { del, get, post, qs, useLoad } from "../api";
import { useListFilter } from "../useListFilter";
import { ApiForm, str } from "../components/ApiForm";
import { org, useUser } from "../session";
import { A, Card, Field, PAGE_SIZE, PageTitle, Pager, Show, Status, Table, Td, btn, btnDanger, btnLight, date, input, pageParam, withParams } from "../components/ui";

// A purchase order as the records endpoint returns it, with the values it shows alongside
type PurchaseOrderRow = {
  po_id: string; vendor_id: string; vendor_name: string; department: string | null; requester: string | null; approver: string | null;
  issue_date: string | null; description: string | null; total_amount: number; currency: string; status: string; billed: number; total_count: number;
};

const TABS = ["open", "partially_invoiced", "closed", "all"];

// Closes a purchase order, after confirming: it stays on record, closed, and is no longer offered for invoices.
function CloseOrder({ p, onClosed }: { p: PurchaseOrderRow; onClosed: () => void }) {
  const user = useUser();
  if (p.status === "closed" || !can(user, "po.manage")) return null;
  const close = async () => {
    await del(org(user, `/purchase-orders/${p.po_id}`));
    onClosed();
  };
  return (
    <ApiForm inline submit={close} confirm={`Close ${p.po_id} (${p.vendor_name}, ${money(p.total_amount - p.billed)} remaining)? It is no longer offered for invoices.`}>
      <button className={btnDanger}>Close</button>
    </ApiForm>
  );
}

// What is left on an order; below zero means invoices billed more than it allowed.
const Remaining = ({ value }: { value: number }) => <span className={value < 0 ? "font-bold text-flag" : ""}>{money(value)}</span>;

// A new purchase order, for any vendor: its own row above the list, opened from "+ Add purchase order".
function NewOrder({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const user = useUser();
  const choices = useLoad(async () => {
    const [vendors, depts] = await Promise.all([
      get<{ vendor_id: string; legal_name: string; status: string }[]>(org(user, "/vendor-choices")),
      get<{ department_id: string; name: string }[]>(org(user, "/departments")),
    ]);
    return { vendors, depts };
  }, "");
  const add = async (fd: FormData) => {
    await post(org(user, "/purchase-orders"), {
      vendor_id: str(fd, "vendor_id"), description: str(fd, "description"), total_amount: Number(str(fd, "total_amount")), currency: str(fd, "currency") ?? "CAD",
      department_id: str(fd, "department_id"), issue_date: str(fd, "issue_date"), status: "open",
    });
    onAdded();
  };
  return (
    <ApiForm submit={add} className="mb-4 grid grid-cols-2 gap-3 border-b border-line pb-4 sm:grid-cols-3">
      <Field label="Vendor">
        <select name="vendor_id" className={input} required>
          <option value="">Choose…</option>
          {(choices.data?.vendors ?? []).filter((v) => v.status !== "on_hold").map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}</option>)}
        </select>
      </Field>
      <Field label="Description"><input name="description" className={input} required /></Field>
      <Field label="Total"><input name="total_amount" type="number" step="0.01" min="0.01" className={input} required /></Field>
      <Field label="Department">
        <select name="department_id" className={input} required>
          <option value="">Choose…</option>
          {(choices.data?.depts ?? []).map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Issued"><input name="issue_date" type="date" className={input} required /></Field>
      <Field label="Currency"><select name="currency" className={input}><option>CAD</option><option>USD</option></select></Field>
      <div className="col-span-full flex gap-3">
        <button className={btn}>Add purchase order</button>
        <button type="button" className={btnLight} onClick={onCancel}>Cancel</button>
      </div>
    </ApiForm>
  );
}

export function PurchaseOrders() {
  const user = useUser();
  const { sp, search, draft, setDraft, term } = useListFilter();
  const [adding, setAdding] = useState(false);
  const status = TABS.includes(sp.get("status") ?? "") ? sp.get("status")! : "open";
  const page = pageParam(sp.get("page"));
  const load = useLoad(
    () => get<PurchaseOrderRow[]>(org(user, `/purchase-orders${qs({ q: search, status: status === "all" ? null : status, page, size: PAGE_SIZE })}`)),
    `${search}:${status}:${page}`,
  );
  return (
    <div className="space-y-5">
      <PageTitle>Purchase orders</PageTitle>
      <Card
        title={`${load.data?.[0]?.total_count ?? 0} purchase orders`}
        actions={
          <>
            <input
              className="input mr-1 w-60 max-w-full"
              type="search"
              aria-label="Filter purchase orders"
              placeholder="Purchase order, vendor or description"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {TABS.map((s) => (
              <Link key={s} to={withParams(sp, { status: s, q: term || null, page: null })} className="chip" aria-current={s === status}>{s.replace(/_/g, " ")}</Link>
            ))}
            {can(user, "po.manage") && !adding && <button type="button" className={btn} onClick={() => setAdding(true)}>+ Add purchase order</button>}
          </>
        }
      >
        {adding && <NewOrder onAdded={() => { setAdding(false); load.reload(); }} onCancel={() => setAdding(false)} />}
        <Show load={load}>
          {(rows) => (
            <>
              <Table head={["Purchase order", "Vendor", "Department", "Description", "Total", "Billed", "Remaining", "Issued", "Status", ""]} empty={search ? "No purchase orders match your search." : "No purchase orders."}>
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
                    <Td className="text-right"><CloseOrder p={p} onClosed={() => load.reload()} /></Td>
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
  const [sp] = useSearchParams();
  const invPage = pageParam(sp.get("invPage"));
  const load = useLoad(() => get<PurchaseOrderRow>(org(user, `/purchase-orders/${id}`)), id ?? "");
  const invoices = useLoad(() => get<InvoiceRow[]>(org(user, `/invoices${qs({ po_id: id, page: invPage, size: PAGE_SIZE })}`)), `${id}:${invPage}`);
  return (
    <Show load={load}>
      {(p) => (
        <div className="space-y-5">
          <PageTitle sub={<span className="flex items-center gap-3"><Status value={p.status} /><CloseOrder p={p} onClosed={() => load.reload()} /></span>}>{p.po_id} · {p.vendor_name}</PageTitle>
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
            <Card title={`Invoices (${invoices.data?.[0]?.total_count ?? 0})`}>
              <Show load={invoices}>
                {(list) => (
                  <>
              <Table head={["Invoice", "Number", "Date", "Total", "Status"]} empty="No invoices.">
                {list.map((i) => (
                  <tr key={i.invoice_id}>
                    <Td><A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A></Td>
                    <Td>{i.vendor_invoice_number}</Td>
                    <Td>{date(i.invoice_date)}</Td>
                    <Td>{money(i.total, i.currency)}</Td>
                    <Td><Status value={i.status} /></Td>
                  </tr>
                ))}
              </Table>
              <Pager param="invPage" page={invPage} total={list[0]?.total_count ?? 0} />
                  </>
                )}
              </Show>
            </Card>
          </div>
        </div>
      )}
    </Show>
  );
}
