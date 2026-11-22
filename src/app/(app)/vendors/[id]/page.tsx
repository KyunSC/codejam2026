import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { one, query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Card, Field, PageTitle, Status, Table, Td, btn, btnDanger, btnLight, date, input, money } from "@/components/ui";
import { bankChangeAction, confirmCallbackAction, decideBankChangeAction, vendorStatusAction } from "../../../actions";

export default async function VendorPage({ params }: PageProps<"/vendors/[id]">) {
  const user = await requireUser();
  if (!can(user, "vendor.view")) notFound();
  const { id } = await params;
  const v = await one<Record<string, string | number | boolean | null>>("SELECT * FROM vendors WHERE vendor_id=$1 AND organization_id=$2", [id, user.organization_id]);
  if (!v) notFound();
  const changes = await query<{ change_id: string; requested_at: string; requester: string | null; request_channel: string; new_institution: string | null; new_transit: string | null; new_account: string; verified_by_callback: boolean; status: string; approver: string | null }>(
    `SELECT c.*, u1.full_name requester, u2.full_name approver FROM vendor_bank_changes c LEFT JOIN users u1 ON u1.user_id=c.requested_by LEFT JOIN users u2 ON u2.user_id=c.approved_by
      WHERE c.vendor_id=$1 ORDER BY c.requested_at DESC`,
    [id],
  );
  const contracts = await query<{ contract_id: string; description: string; billing_type: string; monthly_fee: number | null; hourly_rate_cap: number | null; fuel_surcharge_cap_pct: number | null; not_to_exceed_monthly: number | null; end_date: string | null; status: string; currency: string }>(
    "SELECT * FROM contracts WHERE vendor_id=$1 ORDER BY contract_id",
    [id],
  );
  const pos = await query<{ po_id: string; description: string; total_amount: number; status: string; issue_date: string }>("SELECT * FROM purchase_orders WHERE vendor_id=$1 ORDER BY issue_date DESC", [id]);
  const invoices = await query<{ invoice_id: string; vendor_invoice_number: string; invoice_date: string; total: number; currency: string; status: string }>(
    "SELECT invoice_id, vendor_invoice_number, invoice_date, total, currency, status FROM invoices WHERE vendor_id=$1 ORDER BY invoice_date DESC LIMIT 50",
    [id],
  );
  const row = (k: string, label: string) => (
    <>
      <dt className="muted">{label}</dt>
      <dd>{v[k] === true ? "yes" : v[k] === false ? "no" : String(v[k] ?? "—")}</dd>
    </>
  );
  return (
    <div className="space-y-5">
      <PageTitle sub={<Status value={String(v.status)} />}>{String(v.legal_name)} <span className="text-base font-normal muted">{id}</span></PageTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Details"
          actions={can(user, "vendor.approve") && (
            <>
              {v.status !== "active" && <ActionForm action={vendorStatusAction.bind(null, id, "active")}><button className={btn}>Approve vendor</button></ActionForm>}
              {v.status !== "on_hold" && <ActionForm action={vendorStatusAction.bind(null, id, "on_hold")}><button className={btnDanger}>Put on hold</button></ActionForm>}
            </>
          )}
        >
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {row("category", "Category")}{row("default_gl_account", "Default GL")}{row("address", "Address")}{row("country", "Country")}
            {row("gst_hst_number", "GST/HST")}{row("qst_number", "QST")}{row("payment_terms_days", "Terms (days)")}{row("early_pay_discount", "Early-pay discount")}
            {row("preferred_payment_method", "Pays by")}{row("ap_contact_email", "Billing email")}{row("requires_po", "Requires PO")}{row("onboarded_at", "Onboarded")}
            <dt className="muted">Bank account</dt><dd className="font-mono">{v.bank_account ? `${v.bank_institution}-${v.bank_transit}-${v.bank_account}` : "—"}</dd>
          </dl>
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
                    <ActionForm action={decideBankChangeAction.bind(null, c.change_id, id)} className="space-y-1">
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="verified" /> called the vendor</label>
                      <div className="flex gap-1">
                        <button name="decision" value="approved" className={btn}>Approve</button>
                        <button name="decision" value="rejected" className={btnDanger}>Reject</button>
                      </div>
                    </ActionForm>
                  )}
                  {can(user, "bank_change.approve") && c.status === "approved" && !c.verified_by_callback && (
                    <ActionForm action={confirmCallbackAction.bind(null, c.change_id, id)}><button className={btnLight}>Confirmed by callback</button></ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {can(user, "bank_change.request") && (
            <ActionForm action={bankChangeAction.bind(null, id)} className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
              <Field label="Institution"><input name="institution" className={input} required /></Field>
              <Field label="Transit"><input name="transit" className={input} required /></Field>
              <Field label="Account"><input name="account" className={input} required /></Field>
              <Field label="Requested by">
                <select name="channel" className={input}><option value="email_request">email</option><option value="phone_callback_verified">phone</option><option value="vendor_portal">vendor portal</option></select>
              </Field>
              <label className="col-span-2 flex items-end gap-1 pb-1 text-xs"><input type="checkbox" name="verified" /> confirmed by calling the number on file</label>
              <div className="col-span-3"><button className={btnLight}>Request bank change</button></div>
            </ActionForm>
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
        </Card>

        <Card title="Purchase orders">
          <Table head={["PO", "Description", "Total", "Issued", "Status"]} empty="No POs.">
            {pos.map((p) => (
              <tr key={p.po_id}><Td>{p.po_id}</Td><Td>{p.description}</Td><Td>{money(p.total_amount)}</Td><Td>{date(p.issue_date)}</Td><Td><Status value={p.status} /></Td></tr>
            ))}
          </Table>
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
}
