import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { InvoiceRow } from "@/services/read.service";
import { del, get, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { A, Card, Field, OptionalFields, PAGE_SIZE, PageTitle, Pager, Show, Status, Table, Td, btn, btnDanger, btnLight, date, input, pageParam } from "../components/ui";
import { VendorLink } from "../components/VendorLink";

// A contract as the records endpoint returns it, with its vendor's name
type ContractRow = {
  contract_id: string; vendor_id: string; vendor_name: string; description: string | null; monthly_fee: number | null; currency: string;
  hourly_rate_cap: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly: number | null; start_date: string | null; end_date: string | null;
  auto_renew: boolean | null; status: string; total_count: number;
};

const TABS = ["active", "expired", "all"];

// The terms invoices are checked against, one per line
function Terms({ c }: { c: ContractRow }) {
  return (
    <>
      {c.monthly_fee != null && <div>Monthly fee {money(c.monthly_fee, c.currency)}</div>}
      {c.hourly_rate_cap != null && <div>Rate cap {money(c.hourly_rate_cap, c.currency)}/h</div>}
      {c.fuel_surcharge_cap_pct != null && <div>Fuel surcharge cap {c.fuel_surcharge_cap_pct}%</div>}
      {c.not_to_exceed_monthly != null && <div>Max {money(c.not_to_exceed_monthly, c.currency)}/month</div>}
    </>
  );
}

// Ends a contract, after confirming: it stays on record, expired, and is no longer matched to new invoices.
function EndContract({ c, onEnded }: { c: ContractRow; onEnded: () => void }) {
  const user = useUser();
  if (c.status === "expired" || !can(user, "contract.manage")) return null;
  const end = async () => {
    await del(org(user, `/contracts/${c.contract_id}`));
    onEnded();
  };
  return (
    <ApiForm inline submit={end} confirm={`End ${c.contract_id} (${c.vendor_name}, ${c.description ?? "no description"})? It is marked expired.`}>
      <button className={btnDanger}>End</button>
    </ApiForm>
  );
}

const numOrNull = (fd: FormData, k: string) => (str(fd, k) == null ? null : Number(str(fd, k)));

// A new contract, for any vendor: its own row above the list, opened from "+ Add contract".
function NewContract({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const user = useUser();
  const vendors = useLoad(() => get<{ vendor_id: string; legal_name: string; status: string }[]>(org(user, "/vendor-choices")), "");
  const add = async (fd: FormData) => {
    await post(org(user, "/contracts"), {
      vendor_id: str(fd, "vendor_id"), description: str(fd, "description"), currency: str(fd, "currency") ?? "CAD",
      monthly_fee: numOrNull(fd, "monthly_fee"), hourly_rate_cap: numOrNull(fd, "hourly_rate_cap"), fuel_surcharge_cap_pct: numOrNull(fd, "fuel_surcharge_cap_pct"),
      not_to_exceed_monthly: numOrNull(fd, "not_to_exceed_monthly"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date"), status: "active",
    });
    onAdded();
  };
  return (
    <ApiForm submit={add} className="mb-4 grid grid-cols-2 gap-3 border-b border-line pb-4 sm:grid-cols-3">
      <Field label="Vendor">
        <select name="vendor_id" className={input} required>
          <option value="">Choose…</option>
          {(vendors.data ?? []).filter((v) => v.status !== "on_hold").map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}</option>)}
        </select>
      </Field>
      <Field label="Description"><input name="description" className={input} required /></Field>
      <Field label="Starts"><input name="start_date" type="date" className={input} required /></Field>
      <Field label="Ends"><input name="end_date" type="date" className={input} required /></Field>
      <Field label="Currency"><select name="currency" className={input}><option>CAD</option><option>USD</option></select></Field>
      <OptionalFields className="col-span-full grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Monthly fee"><input name="monthly_fee" type="number" step="0.01" min="0" className={input} /></Field>
        <Field label="Hourly rate cap"><input name="hourly_rate_cap" type="number" step="0.01" min="0" className={input} /></Field>
        <Field label="Fuel surcharge cap (%)"><input name="fuel_surcharge_cap_pct" type="number" step="0.01" min="0" className={input} /></Field>
        <Field label="Monthly limit"><input name="not_to_exceed_monthly" type="number" step="0.01" min="0" className={input} /></Field>
      </OptionalFields>
      <div className="col-span-full flex gap-3">
        <button className={btn}>Add contract</button>
        <button type="button" className={btnLight} onClick={onCancel}>Cancel</button>
      </div>
    </ApiForm>
  );
}

export function Contracts() {
  const user = useUser();
  const [sp] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const status = TABS.includes(sp.get("status") ?? "") ? sp.get("status")! : "active";
  const page = pageParam(sp.get("page"));
  const load = useLoad(
    () => get<ContractRow[]>(org(user, `/contracts${qs({ status: status === "all" ? null : status, page, size: PAGE_SIZE })}`)),
    `${status}:${page}`,
  );
  return (
    <div className="space-y-5">
      <PageTitle>Contracts</PageTitle>
      <Card
        title={`${load.data?.[0]?.total_count ?? 0} contracts`}
        actions={
          <>
            {TABS.map((s) => (
              <Link key={s} to={`/contracts?status=${s}`} className="chip" aria-current={s === status}>{s}</Link>
            ))}
            {can(user, "contract.manage") && !adding && <button type="button" className={btn} onClick={() => setAdding(true)}>+ Add contract</button>}
          </>
        }
      >
        {adding && <NewContract onAdded={() => { setAdding(false); load.reload(); }} onCancel={() => setAdding(false)} />}
        <Show load={load}>
          {(rows) => (
            <>
              <Table head={["Contract", "Vendor", "Description", "Terms", "Starts", "Ends", "Status", ""]} empty="No contracts.">
                {rows.map((c) => (
                  <tr key={c.contract_id}>
                    <Td className="whitespace-nowrap"><A href={`/contracts/${c.contract_id}`}>{c.contract_id}</A></Td>
                    <Td><VendorLink id={c.vendor_id}>{c.vendor_name}</VendorLink></Td>
                    <Td>{c.description}</Td>
                    <Td className="text-xs"><Terms c={c} /></Td>
                    <Td className="whitespace-nowrap">{date(c.start_date)}</Td>
                    <Td className="whitespace-nowrap">{date(c.end_date)}</Td>
                    <Td><Status value={c.status} /></Td>
                    <Td className="text-right"><EndContract c={c} onEnded={() => load.reload()} /></Td>
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

export function Contract() {
  const user = useUser();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const invPage = pageParam(sp.get("invPage"));
  const load = useLoad(() => get<ContractRow>(org(user, `/contracts/${id}`)), id ?? "");
  const invoices = useLoad(() => get<InvoiceRow[]>(org(user, `/invoices${qs({ contract_id: id, page: invPage, size: PAGE_SIZE })}`)), `${id}:${invPage}`);
  return (
    <Show load={load}>
      {(c) => (
        <div className="space-y-5">
          <PageTitle sub={<span className="flex items-center gap-3"><Status value={c.status} /><EndContract c={c} onEnded={() => load.reload()} /></span>}>
            {c.contract_id} · {c.vendor_name}
          </PageTitle>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Details">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="muted">Vendor</dt><dd><VendorLink id={c.vendor_id}>{c.vendor_name}</VendorLink></dd>
                <dt className="muted">Description</dt><dd>{c.description ?? "—"}</dd>
                <dt className="muted">Terms</dt><dd><Terms c={c} /></dd>
                <dt className="muted">Starts</dt><dd>{date(c.start_date)}</dd>
                <dt className="muted">Ends</dt><dd>{date(c.end_date)}{c.auto_renew ? " · renews automatically" : ""}</dd>
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
                          <Td className="whitespace-nowrap">{date(i.invoice_date)}</Td>
                          <Td className="whitespace-nowrap">{money(i.total, i.currency)}</Td>
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
