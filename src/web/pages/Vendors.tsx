import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { channelName, money } from "@/lib/format";
import type { getVendor, listBankChanges, listVendors } from "@/services/vendor.service";
import { del, get, patch, post, qs, useLoad } from "../api";
import { useListFilter } from "../useListFilter";
import { org, useUser } from "../session";
import { ApiForm, numOrNull, str } from "../components/ApiForm";
import { A, Badge, Card, Field, NotFound, OptionalFields, PAGE_SIZE, PageTitle, Pager, Show, Status, Table, Td, btn, btnDanger, btnLight, date, input, pageParam, withParams } from "../components/ui";

type VendorRow = Awaited<ReturnType<typeof listVendors>>[number];

export function Vendors() {
  const user = useUser();
  const { sp, search, draft, setDraft, term } = useListFilter();
  const status = sp.get("status") ?? "all";
  const page = pageParam(sp.get("page"));
  const path = org(user, `/vendors${qs({ q: search, status: status === "all" ? null : status, page, size: PAGE_SIZE })}`);
  const load = useLoad(() => get<VendorRow[]>(path), path);
  // The rows stay on screen, dimmed, while a typed filter waits to apply or the next page loads.
  const busy = term !== search || !!load.stale;
  if (!can(user, "vendor.view")) return <NotFound />;
  return (
    <div className="space-y-5">
      <PageTitle sub="New vendors wait for finance manager approval. A change of bank details is a request that must be verified by callback.">Vendors</PageTitle>
      <Card
        title={busy || !load.data ? "Vendors" : `${load.data[0]?.total_count ?? 0} vendors`}
        actions={
          <>
            <input
              className="input mr-1 w-60 max-w-full"
              type="search"
              aria-label="Filter vendors"
              placeholder="Vendor ID or name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {["all", "active", "pending_review", "on_hold"].map((s) => (
              <Link key={s} to={withParams(sp, { status: s === "all" ? null : s, q: term || null, page: null })} className="chip" aria-current={s === status}>{s.replace("_", " ")}</Link>
            ))}
            {can(user, "vendor.onboard") && <Link to="/vendors/new" className={btn}>Onboard vendor</Link>}
          </>
        }
      >
        <div aria-busy={busy} className={busy ? "opacity-60 transition-opacity" : "transition-opacity"}><Show load={load}>
          {(vendors) => (
            <>
              <Table head={["Vendor", "Category", "Location", "GST/HST", "Pays by", "Invoices", "Status", "Warnings"]} empty={search ? "No vendors match your filter." : "No vendors."}>
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
              <Pager param="page" page={page} total={vendors[0]?.total_count ?? 0} />
            </>
          )}
        </Show></div>
      </Card>
    </div>
  );
}

type Contract = { contract_id: string; description: string; monthly_fee: number | null; hourly_rate_cap: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly: number | null; end_date: string | null; status: string; currency: string };
type VendorView = { v: Awaited<ReturnType<typeof getVendor>>; changes: Awaited<ReturnType<typeof listBankChanges>>; contracts: Contract[] };

// The vendor fields a clerk edits on the vendor page; a vendor needs at least a name, a country and a way to be paid.
const ESSENTIAL_DETAILS = ["legal_name", "country", "preferred_payment_method"];
const DETAIL_FIELDS: [string, string][] = [
  ["legal_name", "Legal name"], ["category", "Category"], ["default_gl_account", "Default GL"], ["address", "Address"],
  ["province_or_state", "Province / state"], ["country", "Country"], ["gst_hst_number", "GST/HST"], ["qst_number", "QST"],
  ["payment_terms_days", "Terms (days)"], ["preferred_payment_method", "Pays by"], ["ap_contact_email", "Billing email"], ["phone", "Phone"],
];
// the choices of the fields that have a fixed set of values
const DETAIL_CHOICES: Record<string, string[]> = { country: ["CA", "US"], preferred_payment_method: ["EFT", "CHEQUE", "CARD"] };

export function Vendor() {
  const user = useUser();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // Edit turns the details into inputs where they stand
  const [editing, setEditing] = useState(false);
  const load = useLoad(async (): Promise<VendorView> => {
    const [v, changes, contracts] = await Promise.all([
      get<VendorView["v"]>(org(user, `/vendors/${id}`)),
      get<VendorView["changes"]>(org(user, `/vendors/${id}/bank-changes`)),
      get<Contract[]>(org(user, `/contracts${qs({ vendor_id: id })}`)),
    ]);
    return { v, changes, contracts };
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
  const deleteVendor = async () => {
    await del(org(user, `/vendors/${id}`));
    navigate("/vendors");
  };
  const saveDetails = async (fd: FormData) => {
    const body: Record<string, unknown> = {};
    for (const k of DETAIL_FIELDS.map(([k]) => k)) body[k] = k === "payment_terms_days" ? numOrNull(fd, k) : str(fd, k);
    body.requires_po = fd.get("requires_po") === "on";
    await patch(org(user, `/vendors/${id}`), body);
    setEditing(false);
    return done("Saved.");
  };
  const confirmCallback = (changeId: string) => async () => {
    await post(org(user, `/bank-changes/${changeId}/confirm-callback`));
    return done("Confirmed by callback.");
  };

  return (
    <Show load={load}>
      {({ v, changes, contracts }) => {
        const shown = (k: string) => (v[k] === true ? "yes" : v[k] === false ? "no" : String(v[k] ?? "—"));
        // a detail as text, or while editing as its input
        const field = (k: string) => {
          const value = v[k] == null ? "" : String(v[k]);
          const required = ESSENTIAL_DETAILS.includes(k);
          if (DETAIL_CHOICES[k]) return <select name={k} defaultValue={value} className={input} required={required}>{DETAIL_CHOICES[k].map((c) => <option key={c}>{c}</option>)}</select>;
          return <input name={k} type={k === "payment_terms_days" ? "number" : k === "ap_contact_email" ? "email" : "text"} defaultValue={value} className={input} required={required} />;
        };
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
                actions={
                  <>
                    {can(user, "vendor.onboard") && !editing && <button className={btnLight} onClick={() => setEditing(true)}>Edit</button>}
                    {can(user, "vendor.approve") && v.status !== "active" && <ApiForm submit={setStatus("approve")} confirm={`Approve ${v.legal_name} as an active vendor?`}><button className={btn}>Approve vendor</button></ApiForm>}
                    {can(user, "vendor.approve") && v.status !== "on_hold" && <ApiForm submit={setStatus("hold")} confirm={`Put ${v.legal_name} on hold? Its new invoices are blocked until it is approved again.`}><button className={btnDanger}>Put on hold</button></ApiForm>}
                  </>
                }
              >
                <ApiForm key={String(editing)} submit={saveDetails}>
                  <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                    {DETAIL_FIELDS.filter(([k]) => editing || k !== "legal_name").map(([k, label]) => (
                      <div key={k} className="contents">
                        <dt className="muted">{label}</dt>
                        <dd>{editing ? field(k) : shown(k)}</dd>
                      </div>
                    ))}
                    <dt className="muted">Requires a purchase order</dt>
                    <dd>{editing ? <input type="checkbox" name="requires_po" defaultChecked={!!v.requires_po} /> : shown("requires_po")}</dd>
                    <dt className="muted">Early-pay discount</dt><dd>{shown("early_pay_discount")}</dd>
                    <dt className="muted">Onboarded</dt><dd>{shown("onboarded_at")}</dd>
                    <dt className="muted">Bank account</dt><dd className="font-mono">{v.bank_account ? `${v.bank_institution}-${v.bank_transit}-${v.bank_account}` : "—"}</dd>
                  </dl>
                  {editing && (
                    <div className="mt-4 flex gap-2">
                      <button className={btn}>Save details</button>
                      <button type="button" className={btnLight} onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                  )}
                </ApiForm>
              </Card>

              <div className="space-y-5">
              <Card title="Bank details changes">
                <Table head={["Change", "Requested", "Asked through", "New account", "Callback", "Status", ""]} empty="No changes.">
                  {changes.map((c) => (
                    <tr key={c.change_id}>
                      <Td className="font-mono text-xs">{c.change_id}</Td>
                      <Td className="text-xs">{date(c.requested_at)}<br />{c.requester}</Td>
                      <Td className="text-xs">{channelName(c.request_channel)}</Td>
                      <Td className="font-mono text-xs">{c.new_institution ? `${c.new_institution}-${c.new_transit}-` : "…"}{c.new_account}</Td>
                      <Td>{c.verified_by_callback ? "verified" : <span className="text-flag">not verified</span>}</Td>
                      <Td><Status value={c.status} /></Td>
                      <Td>
                        {can(user, "bank_change.approve") && c.status === "pending" && (
                          <ApiForm submit={decideChange(c.change_id)} className="space-y-1" confirm={(fd) => fd.get("decision") === "rejected"
                            ? `Reject the change of ${v.legal_name}'s bank account to ${c.new_account}?`
                            : `Approve the change of ${v.legal_name}'s bank account to ${c.new_account}? Payments will go to the new account.`}>
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="verified" /> called the vendor</label>
                            <div className="flex gap-1">
                              <button name="decision" value="approved" className={btn}>Approve</button>
                              <button name="decision" value="rejected" className={btnDanger}>Reject</button>
                            </div>
                          </ApiForm>
                        )}
                        {can(user, "bank_change.approve") && c.status === "approved" && !c.verified_by_callback && (
                          <ApiForm submit={confirmCallback(c.change_id)} confirm={`Confirm you called ${v.legal_name} on the number on file and they confirmed account ${c.new_account}?`}><button className={btnLight}>Confirmed by callback</button></ApiForm>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
                {can(user, "bank_change.request") && (
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm font-bold">Request a bank change</summary>
                  <ApiForm reset submit={requestChange} className="mt-3 grid grid-cols-2 gap-2">
                    <Field label="Institution"><input name="institution" className={input} required /></Field>
                    <Field label="Transit"><input name="transit" className={input} required /></Field>
                    <Field label="Account"><input name="account" className={input} required /></Field>
                    <Field label="Asked through">
                      <select name="channel" className={input}><option value="email_request">email</option><option value="phone">phone</option><option value="vendor_portal">vendor portal</option></select>
                    </Field>
                    <OptionalFields className="grid grid-cols-2 gap-2">
                      <label className="flex items-end gap-1 pb-1 text-xs"><input type="checkbox" name="verified" /> confirmed by calling the number on file</label>
                    </OptionalFields>
                    <div className="col-span-2"><button className={btnLight}>Request bank change</button></div>
                  </ApiForm>
                  </details>
                )}
              </Card>

              <Card title="Contracts">
                <Table head={["Contract", "Description", "Terms", "Ends", "Status"]} empty="No contract.">
                  {contracts.map((c) => (
                    <tr key={c.contract_id}>
                      <Td><A href={`/contracts/${c.contract_id}`}>{c.contract_id}</A></Td>
                      <Td>{c.description}</Td>
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
              </Card>

              </div>
            </div>
            {can(user, "vendor.onboard") && (
              <ApiForm submit={deleteVendor} confirm={`Delete ${v.legal_name}? This cannot be undone.`} className="border-t border-line pt-5">
                <button className={btnDanger}>Delete vendor</button>
              </ApiForm>
            )}
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
    <div>
      <PageTitle sub="The vendor is created as pending review; the finance manager approves it before its invoices can be paid.">Onboard a vendor</PageTitle>
      <Card>
        <ApiForm submit={create} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {text("legal_name", "Legal name", true)}
          <Field label="Country"><select name="country" className={input}><option>CA</option><option>US</option></select></Field>
          <Field label="Pays by"><select name="preferred_payment_method" className={input}><option>EFT</option><option>CHEQUE</option><option>CARD</option></select></Field>
          <OptionalFields className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <label className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" name="requires_po" /> Requires a purchase order</label>
          <div className="col-span-full flex gap-3">
            <button className={btn}>Create vendor</button>
            <Link to="/vendors" className={btnLight}>Cancel</Link>
          </div>
        </ApiForm>
      </Card>
    </div>
  );
}
