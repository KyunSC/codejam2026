import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { getVendor, listBankChanges, listVendors } from "@/services/vendor.service";
import type { InvoiceRow } from "@/services/read.service";
import { get, patch, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm, numOrNull, str } from "../components/ApiForm";
import { A, Badge, Card, Field, NotFound, OptionalFields, PageTitle, Show, Status, Table, Td, btn, btnDanger, btnLight, date, input } from "../components/ui";

type VendorRow = Awaited<ReturnType<typeof listVendors>>[number];

export function Vendors() {
  const user = useUser();
  const [sp] = useSearchParams();
  const status = sp.get("status") ?? "all";
  const load = useLoad(() => get<VendorRow[]>(org(user, `/vendors${qs({ status: status === "all" ? null : status })}`)), status);
  if (!can(user, "vendor.view")) return <NotFound />;
  return (
    <div className="space-y-5">
      <PageTitle sub="New vendors wait for finance manager approval. A change of bank details is a request that must be verified by callback.">Vendors</PageTitle>
      <Card
        title={`${load.data?.length ?? 0} vendors`}
        actions={
          <>
            {["all", "active", "pending_review", "on_hold"].map((s) => (
              <Link key={s} to={s === "all" ? "/vendors" : `/vendors?status=${s}`} className="chip" aria-current={s === status}>{s.replace("_", " ")}</Link>
            ))}
            {can(user, "vendor.onboard") && <Link to="/vendors/new" className={btn}>Onboard vendor</Link>}
          </>
        }
      >
        <Show load={load}>
          {(vendors) => (
            <Table head={["Vendor", "Category", "Location", "GST/HST", "Pays by", "Invoices", "Status", "Warnings"]}>
              {vendors.map((v) => (
                <tr key={v.vendor_id}>
                  <Td><A href={`/vendors/${v.vendor_id}`}>{v.legal_name}</A> <span className="text-xs muted">{v.vendor_id}</span></Td>
                  <Td>{v.category}</Td>
                  <Td>{v.province_or_state} {v.country}</Td>
                  <Td className="font-mono text-xs">{v.gst_hst_number ?? "—"}</Td>
                  <Td>{v.preferred_payment_method}</Td>
                  <Td>{v.invoices}</Td>
                  <Td><Status value={v.status} /></Td>
                  <Td className="space-x-1">
                    {v.lookalike_of.length > 0 && <Badge tone="gold">looks like {v.lookalike_of.map((o) => o.legal_name).join(", ")}</Badge>}
                    {v.pending_change && <Badge tone="red">bank change unverified</Badge>}
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

type Contract = { contract_id: string; description: string; billing_type: string; monthly_fee: number | null; hourly_rate_cap: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly: number | null; end_date: string | null; status: string; currency: string };
type Po = { po_id: string; description: string; total_amount: number; status: string; issue_date: string };
type VendorView = { v: Awaited<ReturnType<typeof getVendor>>; changes: Awaited<ReturnType<typeof listBankChanges>>; contracts: Contract[]; pos: Po[]; invoices: InvoiceRow[]; depts: { department_id: string; name: string }[] };

// The vendor fields a clerk edits on the vendor page; a vendor needs at least a name, a country and a way to be paid.
const ESSENTIAL_DETAILS = ["legal_name", "country", "preferred_payment_method"];
const DETAIL_FIELDS: [string, string][] = [
  ["legal_name", "Legal name"], ["category", "Category"], ["default_gl_account", "Default GL account"], ["address", "Address"],
  ["province_or_state", "Province / state"], ["country", "Country"], ["gst_hst_number", "GST/HST number"], ["qst_number", "QST number"],
  ["payment_terms_days", "Payment terms (days)"], ["preferred_payment_method", "Pays by (EFT, CHEQUE, CARD)"], ["ap_contact_email", "Billing email"], ["phone", "Phone"],
];

export function Vendor() {
  const user = useUser();
  const { id = "" } = useParams();
  const load = useLoad(async (): Promise<VendorView> => {
    const [v, changes, contracts, pos, invoices, depts] = await Promise.all([
      get<VendorView["v"]>(org(user, `/vendors/${id}`)),
      get<VendorView["changes"]>(org(user, `/vendors/${id}/bank-changes`)),
      get<Contract[]>(org(user, `/contracts${qs({ vendor_id: id })}`)),
      get<Po[]>(org(user, `/purchase-orders${qs({ vendor_id: id })}`)),
      get<InvoiceRow[]>(org(user, `/invoices${qs({ vendor_id: id, size: 50 })}`)),
      get<{ department_id: string; name: string }[]>(org(user, "/departments")),
    ]);
    return { v, changes, contracts, pos, invoices, depts };
  }, id);
  if (!can(user, "vendor.view")) return <NotFound />;

  const done = (msg: string) => {
    load.reload();
    return msg;
  };
  const setStatus = (path: "approve" | "hold") => async () => {
    await post(org(user, `/vendors/${id}/${path}`));
    return done(path === "approve" ? "Vendor approved." : "Vendor on hold.");
  };
  const requestChange = async (fd: FormData) => {
    await post(org(user, `/vendors/${id}/bank-changes`), {
      institution: str(fd, "institution"), transit: str(fd, "transit"), account: str(fd, "account") ?? "",
      channel: str(fd, "channel") ?? "email_request", verified_by_callback: fd.get("verified") === "on",
    });
    return done("Change requested; the finance manager approves it.");
  };
  const decideChange = (changeId: string) => async (fd: FormData) => {
    const rejected = str(fd, "decision") === "rejected";
    await post(org(user, `/bank-changes/${changeId}/${rejected ? "reject" : "approve"}`), { verified_by_callback: fd.get("verified") === "on" });
    return done(`Change ${rejected ? "rejected" : "approved"}.`);
  };
  const saveDetails = async (fd: FormData) => {
    const body: Record<string, unknown> = {};
    for (const k of DETAIL_FIELDS.map(([k]) => k)) body[k] = k === "payment_terms_days" ? numOrNull(fd, k) : str(fd, k);
    body.requires_po = fd.get("requires_po") === "on";
    await patch(org(user, `/vendors/${id}`), body);
    return done("Saved.");
  };
  const addContract = async (fd: FormData) => {
    await post(org(user, "/contracts"), {
      vendor_id: id, description: str(fd, "description"), billing_type: str(fd, "billing_type"), currency: str(fd, "currency") ?? "CAD",
      monthly_fee: numOrNull(fd, "monthly_fee"), hourly_rate_cap: numOrNull(fd, "hourly_rate_cap"), not_to_exceed_monthly: numOrNull(fd, "not_to_exceed_monthly"),
      start_date: str(fd, "start_date"), end_date: str(fd, "end_date"), status: "active",
    });
    return done("Contract added.");
  };
  const addPo = async (fd: FormData) => {
    await post(org(user, "/purchase-orders"), {
      vendor_id: id, description: str(fd, "description"), total_amount: numOrNull(fd, "total_amount"), currency: str(fd, "currency") ?? "CAD",
      department_id: str(fd, "department_id"), issue_date: str(fd, "issue_date"), status: "open",
    });
    return done("Purchase order added.");
  };
  const confirmCallback = (changeId: string) => async () => {
    await post(org(user, `/bank-changes/${changeId}/confirm-callback`));
    return done("Confirmed by callback.");
  };

  return (
    <Show load={load}>
      {({ v, changes, contracts, pos, invoices, depts }) => {
        const row = (k: string, label: string) => (
          <>
            <dt className="muted">{label}</dt>
            <dd>{v[k] === true ? "yes" : v[k] === false ? "no" : String(v[k] ?? "—")}</dd>
          </>
        );
        return (
          <div className="space-y-5">
            <PageTitle sub={<Status value={v.status} />}>{v.legal_name} <span className="text-base font-normal muted">{id}</span></PageTitle>
            {v.lookalike_of.length > 0 && (
              <p className="form-error">
                The name looks like {v.lookalike_of.map((o, i) => <span key={o.vendor_id}>{i > 0 && ", "}<A href={`/vendors/${o.vendor_id}`}>{o.legal_name} ({o.vendor_id})</A></span>)}. Check it is not a duplicate or an impersonation before approving.
              </p>
            )}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card
                title="Details"
                actions={can(user, "vendor.approve") && (
                  <>
                    {v.status !== "active" && <ApiForm submit={setStatus("approve")}><button className={btn}>Approve vendor</button></ApiForm>}
                    {v.status !== "on_hold" && <ApiForm submit={setStatus("hold")}><button className={btnDanger}>Put on hold</button></ApiForm>}
                  </>
                )}
              >
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {row("category", "Category")}{row("default_gl_account", "Default GL")}{row("address", "Address")}{row("country", "Country")}
                  {row("gst_hst_number", "GST/HST")}{row("qst_number", "QST")}{row("payment_terms_days", "Terms (days)")}{row("early_pay_discount", "Early-pay discount")}
                  {row("preferred_payment_method", "Pays by")}{row("ap_contact_email", "Billing email")}{row("phone", "Phone")}{row("requires_po", "Requires a purchase order")}{row("onboarded_at", "Onboarded")}
                  <dt className="muted">Bank account</dt><dd className="font-mono">{v.bank_account ? `${v.bank_institution}-${v.bank_transit}-${v.bank_account}` : "—"}</dd>
                </dl>
                {can(user, "vendor.onboard") && (
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-bold">Edit details</summary>
                    <ApiForm submit={saveDetails} className="mt-3 grid grid-cols-2 gap-2">
                      {DETAIL_FIELDS.filter(([k]) => ESSENTIAL_DETAILS.includes(k)).map(([k, label]) => (
                        <Field key={k} label={label}><input name={k} defaultValue={v[k] == null ? "" : String(v[k])} className={input} required /></Field>
                      ))}
                      <OptionalFields className="grid grid-cols-2 gap-2">
                        {DETAIL_FIELDS.filter(([k]) => !ESSENTIAL_DETAILS.includes(k)).map(([k, label]) => (
                          <Field key={k} label={label}><input name={k} defaultValue={v[k] == null ? "" : String(v[k])} className={input} /></Field>
                        ))}
                        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="requires_po" defaultChecked={!!v.requires_po} /> Requires a purchase order</label>
                      </OptionalFields>
                      <div className="col-span-2 text-xs muted">Bank details change through a bank change request.</div>
                      <div className="col-span-2"><button className={btnLight}>Save details</button></div>
                    </ApiForm>
                  </details>
                )}
              </Card>

              <Card title="Bank details changes">
                <Table head={["Change", "Requested", "Channel", "New account", "Callback", "Status", ""]} empty="No changes.">
                  {changes.map((c) => (
                    <tr key={c.change_id}>
                      <Td className="font-mono text-xs">{c.change_id}</Td>
                      <Td className="text-xs">{date(c.requested_at)}<br />{c.requester}</Td>
                      <Td className="text-xs">{c.request_channel.replace(/_/g, " ")}</Td>
                      <Td className="font-mono text-xs">{c.new_institution ? `${c.new_institution}-${c.new_transit}-` : "…"}{c.new_account}</Td>
                      <Td>{c.verified_by_callback ? "verified" : <span className="text-flag">not verified</span>}</Td>
                      <Td><Status value={c.status} /></Td>
                      <Td>
                        {can(user, "bank_change.approve") && c.status === "pending" && (
                          <ApiForm submit={decideChange(c.change_id)} className="space-y-1">
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="verified" /> called the vendor</label>
                            <div className="flex gap-1">
                              <button name="decision" value="approved" className={btn}>Approve</button>
                              <button name="decision" value="rejected" className={btnDanger}>Reject</button>
                            </div>
                          </ApiForm>
                        )}
                        {can(user, "bank_change.approve") && c.status === "approved" && !c.verified_by_callback && (
                          <ApiForm submit={confirmCallback(c.change_id)}><button className={btnLight}>Confirmed by callback</button></ApiForm>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
                {can(user, "bank_change.request") && (
                  <ApiForm reset submit={requestChange} className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
                    <Field label="Institution"><input name="institution" className={input} required /></Field>
                    <Field label="Transit"><input name="transit" className={input} required /></Field>
                    <Field label="Account"><input name="account" className={input} required /></Field>
                    <Field label="Requested by">
                      <select name="channel" className={input}><option value="email_request">email</option><option value="phone_callback_verified">phone</option><option value="vendor_portal">vendor portal</option></select>
                    </Field>
                    <OptionalFields className="grid grid-cols-1 gap-2">
                      <label className="flex items-end gap-1 pb-1 text-xs"><input type="checkbox" name="verified" /> confirmed by calling the number on file</label>
                    </OptionalFields>
                    <div className="col-span-3"><button className={btnLight}>Request bank change</button></div>
                  </ApiForm>
                )}
              </Card>

              <Card title="Contracts">
                <Table head={["Contract", "Type", "Terms", "Ends", "Status"]} empty="No contract.">
                  {contracts.map((c) => (
                    <tr key={c.contract_id}>
                      <Td>{c.contract_id}</Td>
                      <Td>{c.billing_type.replace("_", " ")}</Td>
                      <Td className="text-xs">
                        {c.monthly_fee != null && <div>Monthly fee {money(c.monthly_fee, c.currency)}</div>}
                        {c.hourly_rate_cap != null && <div>Rate cap {money(c.hourly_rate_cap)}/h</div>}
                        {c.fuel_surcharge_cap_pct != null && <div>Fuel surcharge cap {c.fuel_surcharge_cap_pct}%</div>}
                        {c.not_to_exceed_monthly != null && <div>Max {money(c.not_to_exceed_monthly)}/month</div>}
                      </Td>
                      <Td>{date(c.end_date)}</Td>
                      <Td><Status value={c.status} /></Td>
                    </tr>
                  ))}
                </Table>
                {can(user, "contract.manage") && (
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-bold">Add a contract</summary>
                    <ApiForm reset submit={addContract} className="mt-3 grid grid-cols-2 gap-2">
                      <Field label="Description"><input name="description" className={input} required /></Field>
                      <Field label="Type"><select name="billing_type" className={input}><option value="fixed_monthly">fixed monthly</option><option value="rate_card">rate card</option><option value="retainer">retainer</option><option value="blanket">blanket</option></select></Field>
                      <OptionalFields className="grid grid-cols-2 gap-2">
                      <Field label="Monthly fee"><input name="monthly_fee" type="number" step="0.01" className={input} /></Field>
                      <Field label="Hourly rate cap"><input name="hourly_rate_cap" type="number" step="0.01" className={input} /></Field>
                      <Field label="Monthly limit"><input name="not_to_exceed_monthly" type="number" step="0.01" className={input} /></Field>
                      <Field label="Currency"><select name="currency" className={input}><option>CAD</option><option>USD</option></select></Field>
                      <Field label="Starts"><input name="start_date" type="date" className={input} /></Field>
                      <Field label="Ends"><input name="end_date" type="date" className={input} /></Field>
                      </OptionalFields>
                      <div className="col-span-2"><button className={btnLight}>Add contract</button></div>
                    </ApiForm>
                  </details>
                )}
              </Card>

              <Card title="Purchase orders">
                <Table head={["Purchase order", "Description", "Total", "Issued", "Status"]} empty="No purchase orders.">
                  {pos.map((p) => (
                    <tr key={p.po_id}><Td>{p.po_id}</Td><Td>{p.description}</Td><Td>{money(p.total_amount)}</Td><Td>{date(p.issue_date)}</Td><Td><Status value={p.status} /></Td></tr>
                  ))}
                </Table>
                {can(user, "po.manage") && (
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-bold">Add a purchase order</summary>
                    <ApiForm reset submit={addPo} className="mt-3 grid grid-cols-2 gap-2">
                      <Field label="Description"><input name="description" className={input} required /></Field>
                      <Field label="Total"><input name="total_amount" type="number" step="0.01" className={input} required /></Field>
                      <Field label="Department"><select name="department_id" className={input} required><option value="">Choose…</option>{depts.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}</select></Field>
                      <Field label="Issued"><input name="issue_date" type="date" className={input} required /></Field>
                      <OptionalFields className="grid grid-cols-2 gap-2">
                        <Field label="Currency"><select name="currency" className={input}><option>CAD</option><option>USD</option></select></Field>
                      </OptionalFields>
                      <div className="col-span-2"><button className={btnLight}>Add purchase order</button></div>
                    </ApiForm>
                  </details>
                )}
              </Card>

              <Card title="Invoices" className="lg:col-span-2">
                <Table head={["Invoice", "Number", "Date", "Total", "Status"]} empty="No invoices.">
                  {invoices.map((i) => (
                    <tr key={i.invoice_id}><Td><A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A></Td><Td>{i.vendor_invoice_number}</Td><Td>{date(i.invoice_date)}</Td><Td>{money(i.total, i.currency)}</Td><Td><Status value={i.status} /></Td></tr>
                  ))}
                </Table>
              </Card>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

export function NewVendor() {
  const user = useUser();
  const navigate = useNavigate();
  const gls = useLoad(() => get<{ account_number: string; name: string }[]>(org(user, `/gl-accounts${qs({ account_type: "expense" })}`)), "");
  if (!can(user, "vendor.onboard")) return <NotFound />;
  const create = async (fd: FormData) => {
    const r = await post<{ id: string }>(org(user, "/vendors"), {
      legal_name: str(fd, "legal_name") ?? "",
      category: str(fd, "category"),
      default_gl_account: str(fd, "default_gl_account"),
      address: str(fd, "address"),
      province_or_state: str(fd, "province_or_state"),
      country: str(fd, "country") ?? "CA",
      gst_hst_number: str(fd, "gst_hst_number"),
      qst_number: str(fd, "qst_number"),
      payment_terms_days: numOrNull(fd, "payment_terms_days"),
      preferred_payment_method: str(fd, "preferred_payment_method") ?? "EFT",
      bank_institution: str(fd, "bank_institution"),
      bank_transit: str(fd, "bank_transit"),
      bank_account: str(fd, "bank_account"),
      ap_contact_email: str(fd, "ap_contact_email"),
      phone: str(fd, "phone"),
      requires_po: fd.get("requires_po") === "on",
    });
    navigate(`/vendors/${r.id}`);
  };
  const text = (name: string, label: string, required = false) => <Field label={label}><input name={name} className={input} required={required} /></Field>;
  return (
    <div className="max-w-3xl">
      <PageTitle sub="The vendor is created as pending review; the finance manager approves it before its invoices can be paid.">Onboard a vendor</PageTitle>
      <Card>
        <ApiForm submit={create} className="grid grid-cols-2 gap-3">
          {text("legal_name", "Legal name", true)}
          <Field label="Country"><select name="country" className={input}><option>CA</option><option>US</option></select></Field>
          <Field label="Pays by"><select name="preferred_payment_method" className={input}><option>EFT</option><option>CHEQUE</option><option>CARD</option></select></Field>
          <OptionalFields className="grid grid-cols-2 gap-3">
          {text("category", "Category")}
          <Field label="Default GL account">
            <select name="default_gl_account" className={input}>
              <option value="">—</option>
              {(gls.data ?? []).map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
            </select>
          </Field>
          {text("address", "Address")}
          {text("province_or_state", "Province / state")}
          {text("gst_hst_number", "GST/HST number")}
          {text("qst_number", "QST number")}
          {text("payment_terms_days", "Payment terms (days)")}
          {text("bank_institution", "Bank institution")}
          {text("bank_transit", "Transit")}
          {text("bank_account", "Account")}
          {text("ap_contact_email", "Billing email")}
          {text("phone", "Phone (for bank change callbacks)")}
          </OptionalFields>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="requires_po" /> Requires a purchase order</label>
          <div className="col-span-2"><button className={btn}>Create vendor</button></div>
        </ApiForm>
      </Card>
    </div>
  );
}
