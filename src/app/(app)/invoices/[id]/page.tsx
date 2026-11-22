import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can, invoiceScope } from "@/lib/authz";
import { one, query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Badge, Card, Field, PageTitle, Status, Table, Td, btn, btnDanger, btnLight, date, dateTime, input, money } from "@/components/ui";
import { canActOn } from "@/services/approval.service";
import type { ParsedInvoice } from "@/services/pipeline.service";
import type { RawItem } from "@/services/rawIntake.service";
import type { InvoiceLine, User } from "@/lib/types";
import {
  approveParsedAction, decideAction, prepareAction, rejectParsedAction, resolveFlagAction, saveReviewAction,
} from "../../../actions";

type Invoice = {
  invoice_id: string; parsed_invoice_id: string | null; is_historical: boolean; type: string; status: string; vendor_id: string; vendor_name: string;
  vendor_invoice_number: string; invoice_date: string; due_date: string | null; currency: string; subtotal: number; gst_hst_amount: number; pst_qst_amount: number;
  total: number; fx_rate_to_cad: number; total_cad: number; department_id: string | null; department: string | null; requester: string | null; requester_user_id: string | null;
  po_id: string | null; contract_id: string | null; ship_to_province: string | null; lines: InvoiceLine[]; duplicate_of_invoice_id: string | null; credit_for_invoice_id: string | null;
};
type Flag = { flag_id: string; line_no: number | null; check_code: string; category: string; severity: string; message: string; status: string; resolution_note: string | null; resolver: string | null; related_invoice_id: string | null };
type Step = { approval_id: string; invoice_id: string; step_no: number; rule_id: string | null; assigned_user_id: string | null; original_user_id: string | null; reassign_reason: string | null; status: string; acted_at: string | null; comment: string | null; assignee: string | null; original: string | null; actor: string | null; on_behalf: string | null };

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  let invoice: Invoice | null = null;
  let parsed: ParsedInvoice | null = null;
  if (id.startsWith("PRS-")) {
    parsed = await one<ParsedInvoice>("SELECT * FROM parsed_invoices WHERE parsed_invoice_id=$1 AND organization_id=$2", [id, user.organization_id]);
    if (!parsed) notFound();
    if (parsed.invoice_id) invoice = await loadInvoice(user, parsed.invoice_id);
  } else {
    invoice = await loadInvoice(user, id);
    if (!invoice) notFound();
    if (invoice.parsed_invoice_id) parsed = await one<ParsedInvoice>("SELECT * FROM parsed_invoices WHERE parsed_invoice_id=$1", [invoice.parsed_invoice_id]);
  }
  const raw = parsed ? await one<RawItem>("SELECT * FROM raw_items WHERE raw_item_id=$1", [parsed.raw_item_id]) : null;
  if (!invoice && parsed && !can(user, "invoice.view_all") && raw?.submitted_by !== user.user_id) notFound();

  const flags = parsed
    ? await query<Flag>(
        `SELECT f.*, u.full_name AS resolver FROM invoice_flags f LEFT JOIN users u ON u.user_id=f.resolved_by WHERE f.parsed_invoice_id=$1
         ORDER BY CASE f.severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.category`,
        [parsed.parsed_invoice_id],
      )
    : [];
  const pending = parsed?.status === "pending";
  const reviewing = pending && can(user, "parsed.review");
  const d = parsed?.invoice_json;
  const path = `/invoices/${id}`;

  const vendors = await query<{ vendor_id: string; legal_name: string; status: string }>("SELECT vendor_id, legal_name, status FROM vendors WHERE organization_id=$1 ORDER BY legal_name", [user.organization_id]);
  const depts = await query<{ department_id: string; name: string }>("SELECT department_id, name FROM departments WHERE organization_id=$1 ORDER BY name", [user.organization_id]);
  const gls = await query<{ account_number: string; name: string }>("SELECT account_number, name FROM gl_accounts WHERE organization_id=$1 AND account_type='expense' ORDER BY account_number", [user.organization_id]);
  const people = await query<{ user_id: string; full_name: string }>("SELECT user_id, full_name FROM users WHERE organization_id=$1 AND status<>'terminated' ORDER BY full_name", [user.organization_id]);
  const vendorName = (vid: string | null | undefined) => vendors.find((v) => v.vendor_id === vid)?.legal_name;

  const steps = invoice
    ? await query<Step>(
        `SELECT a.*, u1.full_name AS assignee, u2.full_name AS original, u3.full_name AS actor, u4.full_name AS on_behalf FROM approvals a
           LEFT JOIN users u1 ON u1.user_id=a.assigned_user_id LEFT JOIN users u2 ON u2.user_id=a.original_user_id
           LEFT JOIN users u3 ON u3.user_id=a.acted_by LEFT JOIN users u4 ON u4.user_id=a.on_behalf_of_user_id
         WHERE a.invoice_id=$1 ORDER BY a.step_no`,
        [invoice.invoice_id],
      )
    : [];
  const actable = new Set<string>();
  for (const s of steps) if (invoice?.requester_user_id !== user.user_id && can(user, "approval.act") && (await canActOn(user, s)).ok) actable.add(s.approval_id);
  const payments = invoice
    ? await query<{ payment_id: string; method: string; amount: number; currency: string; status: string; scheduled_date: string | null; paid_date: string | null }>(
        "SELECT payment_id, method, amount, currency, status, scheduled_date, paid_date FROM payments WHERE invoice_id=$1 ORDER BY payment_id",
        [invoice.invoice_id],
      )
    : [];
  const audit = await query<{ event_id: string; occurred_at: string; action: string; entity_id: string; actor: string | null; actor_role: string | null; on_behalf: string | null; note: string | null }>(
    `SELECT e.event_id, e.occurred_at, e.action, e.entity_id, u.full_name AS actor, e.actor_role, ob.full_name AS on_behalf, e.note FROM audit_events e
       LEFT JOIN users u ON u.user_id=e.actor_user_id LEFT JOIN users ob ON ob.user_id=e.on_behalf_of_user_id
     WHERE e.entity_id = ANY($1) OR e.invoice_id = $2 ORDER BY e.occurred_at, e.event_id`,
    [[parsed?.parsed_invoice_id, parsed?.raw_item_id].filter(Boolean), invoice?.invoice_id ?? ""],
  );

  const title = invoice ? `${invoice.invoice_id} · ${invoice.vendor_name} ${invoice.vendor_invoice_number}` : `${parsed!.parsed_invoice_id} · ${vendorName(d?.vendor_id) ?? d?.vendor_name ?? "Unknown vendor"} ${d?.vendor_invoice_number ?? ""}`;

  return (
    <div className="space-y-5">
      <PageTitle sub={invoice ? <span className="flex gap-2"><Status value={invoice.status} />{invoice.is_historical && <Badge>imported history</Badge>}{invoice.type === "credit_note" && <Badge tone="violet">credit note</Badge>}</span> : <Status value={parsed!.status} />}>
        {title}
      </PageTitle>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Raw item">
          <RawView raw={raw} file={parsed?.file_name ?? null} />
        </Card>

        <div className="space-y-5">
          {d && (
            <Card title={invoice ? "Invoice" : "Parsed invoice"} actions={parsed?.extraction_model && <span className="text-xs muted">read by {parsed.extraction_model}{parsed.extraction_language === "fr" ? " · French" : ""}</span>}>
              {reviewing ? (
                <ActionForm action={saveReviewAction.bind(null, parsed!.parsed_invoice_id, d.lines.map((l) => l.line_no))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Vendor">
                      <select name="vendor_id" defaultValue={d.vendor_id ?? ""} className={input}>
                        <option value="">— not in vendor master ({d.vendor_name}) —</option>
                        {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name} ({v.vendor_id}){v.status !== "active" ? ` · ${v.status}` : ""}</option>)}
                      </select>
                    </Field>
                    <Field label="Invoice number"><input name="vendor_invoice_number" defaultValue={d.vendor_invoice_number ?? ""} className={input} /></Field>
                    <Field label="Invoice date"><input type="date" name="invoice_date" defaultValue={d.invoice_date ?? ""} className={input} /></Field>
                    <Field label="Due date"><input type="date" name="due_date" defaultValue={d.due_date ?? ""} className={input} /></Field>
                    <Field label="Department">
                      <select name="department_id" defaultValue={d.department_id ?? ""} className={input}>
                        <option value="">—</option>
                        {depts.map((x) => <option key={x.department_id} value={x.department_id}>{x.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Requester">
                      <select name="requester_user_id" defaultValue={d.requester_user_id ?? ""} className={input}>
                        <option value="">— none (route by department) —</option>
                        {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
                      </select>
                    </Field>
                    <Field label="PO">
                      <select name="po_id" defaultValue={d.po_id ?? ""} className={input}>
                        <option value="">— none —</option>
                        {[...new Set([...(d.po_id ? [d.po_id] : []), ...(d.po_candidates ?? [])])].map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Delivered to (province)">
                      <select name="ship_to_province" defaultValue={d.ship_to_province ?? ""} className={input}>
                        <option value="">—</option>
                        {["ON", "BC", "AB", "QC", "MB", "SK"].map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Total"><div className="py-1 text-sm">{money(d.total, d.currency)}{d.currency !== "CAD" && <span className="muted"> = {money(d.total_cad)} at {d.fx_rate_to_cad}</span>}</div></Field>
                  </div>
                  <LinesTable lines={d.lines} gls={gls} depts={depts} editable currency={d.currency} />
                  <Taxes d={d} />
                  <button className={btn}>Save changes</button>
                </ActionForm>
              ) : (
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <Item k="Vendor">{invoice ? <A href={`/vendors/${invoice.vendor_id}`}>{invoice.vendor_name}</A> : vendorName(d.vendor_id) ?? d.vendor_name}</Item>
                    <Item k="Invoice number">{d.vendor_invoice_number}</Item>
                    <Item k="Invoice date">{date(d.invoice_date)}</Item>
                    <Item k="Due date">{date(d.due_date)}</Item>
                    <Item k="Department">{depts.find((x) => x.department_id === d.department_id)?.name ?? "—"}</Item>
                    <Item k="Requester">{people.find((p) => p.user_id === d.requester_user_id)?.full_name ?? "—"}</Item>
                    <Item k="PO">{d.po_id ?? "—"}</Item>
                    <Item k="Contract">{d.contract_id ?? "—"}</Item>
                    <Item k="Delivered to">{d.ship_to_province ?? "—"}</Item>
                    <Item k="Total">{money(d.total, d.currency)}{d.currency !== "CAD" && ` (${money(d.total_cad)})`}</Item>
                    {invoice?.duplicate_of_invoice_id && <Item k="Duplicate of"><A href={`/invoices/${invoice.duplicate_of_invoice_id}`}>{invoice.duplicate_of_invoice_id}</A></Item>}
                    {invoice?.credit_for_invoice_id && <Item k="Credit for"><A href={`/invoices/${invoice.credit_for_invoice_id}`}>{invoice.credit_for_invoice_id}</A></Item>}
                  </dl>
                  <LinesTable lines={invoice?.lines ?? d.lines} gls={gls} depts={depts} currency={d.currency} />
                  <Taxes d={d} />
                </div>
              )}
            </Card>
          )}

          {parsed && (
            <Card title={`Flags (${flags.filter((f) => f.status === "open").length} open)`}>
              {flags.length === 0 && <p className="text-sm text-green">No problems found.</p>}
              <ul className="space-y-3">
                {flags.map((f) => (
                  <li key={f.flag_id} className={`flag ${f.status !== "open" ? "flag--closed" : `flag--${f.severity}`}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-1 flex gap-1"><Status value={f.severity} /><Badge>{f.category}</Badge>{f.line_no && <Badge>line {f.line_no}</Badge>}{f.status !== "open" && <Status value={f.status} />}</div>
                        <p className="text-sm">{f.message} {f.related_invoice_id && <A href={`/invoices/${f.related_invoice_id}`}>Open {f.related_invoice_id}</A>}</p>
                        {f.resolution_note && <p className="mt-1 text-xs muted">{f.resolver}: {f.resolution_note}</p>}
                      </div>
                    </div>
                    {reviewing && f.status === "open" && (
                      <ActionForm action={resolveFlagAction.bind(null, f.flag_id, path)} className="mt-2 flex gap-2">
                        <input name="note" placeholder="What you checked or decided" className={input} required />
                        <select name="status" className="input w-36"><option value="resolved">Resolved</option><option value="overridden">Override</option></select>
                        <button className={btnLight}>Save</button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
              {reviewing && (
                <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
                  <ActionForm action={approveParsedAction.bind(null, parsed.parsed_invoice_id)}>
                    <button className={btn}>Approve into invoices</button>
                  </ActionForm>
                  <ActionForm action={rejectParsedAction.bind(null, parsed.parsed_invoice_id)} className="flex gap-2">
                    <input name="reason" placeholder="Reason" className={input} required />
                    <button className={btnDanger}>Reject</button>
                  </ActionForm>
                </div>
              )}
              {parsed.status === "rejected" && <p className="mt-3 text-sm text-flag">Rejected: {parsed.rejection_reason}</p>}
            </Card>
          )}

          {invoice && (
            <Card title="Approval chain">
              <Table head={["Step", "Approver", "Status", "Decision"]} empty="No approval steps.">
                {steps.map((s) => (
                  <tr key={s.approval_id}>
                    <Td>{s.step_no}{s.rule_id && <span className="ml-1 text-xs muted">{s.rule_id}</span>}</Td>
                    <Td>
                      {s.assignee}
                      {s.reassign_reason && <div className="text-xs muted">{s.reassign_reason === "delegate" ? `delegate for ${s.original}` : s.reassign_reason === "requester_is_approver" ? `${s.original} requested it; escalated` : `${s.original} has left; escalated`}</div>}
                    </Td>
                    <Td><Status value={s.status} /></Td>
                    <Td>
                      {s.actor && <div className="text-xs">{s.actor}{s.on_behalf && ` on behalf of ${s.on_behalf}`} · {dateTime(s.acted_at)}{s.comment && ` · “${s.comment}”`}</div>}
                      {actable.has(s.approval_id) && (
                        <ActionForm action={decideAction.bind(null, s.approval_id, invoice.invoice_id)} className="flex flex-wrap gap-2">
                          <input name="comment" placeholder="Comment (required to reject)" className={input} />
                          <button name="decision" value="approved" className={btn}>Approve</button>
                          <button name="decision" value="rejected" className={btnDanger}>Reject</button>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {invoice && (can(user, "payment.view") || payments.length > 0) && (
            <Card title="Payment" actions={invoice.status === "approved" && invoice.type === "invoice" && can(user, "payment.prepare") && (
              <ActionForm action={prepareAction.bind(null, invoice.invoice_id)}><button className={btn}>Prepare payment</button></ActionForm>
            )}>
              <Table head={["Payment", "Method", "Amount", "Scheduled", "Paid", "Status"]} empty={invoice.type === "credit_note" ? "Credit notes are not paid." : "No payment yet."}>
                {payments.map((p) => (
                  <tr key={p.payment_id}>
                    <Td><A href={`/payments/${p.payment_id}`}>{p.payment_id}</A></Td>
                    <Td>{p.method}</Td>
                    <Td>{money(p.amount, p.currency)}</Td>
                    <Td>{date(p.scheduled_date)}</Td>
                    <Td>{date(p.paid_date)}</Td>
                    <Td><Status value={p.status} /></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      </div>

      <Card title="Audit trail">
        <Table head={["When", "Who", "Action", "On", "Note"]} empty="No events.">
          {audit.map((e) => (
            <tr key={e.event_id}>
              <Td className="whitespace-nowrap text-xs">{dateTime(e.occurred_at)}</Td>
              <Td>{e.actor ?? "system"}{e.actor_role && <span className="ml-1 text-xs muted">{e.actor_role.replace(/_/g, " ")}</span>}{e.on_behalf && <div className="text-xs muted">on behalf of {e.on_behalf}</div>}</Td>
              <Td className="font-mono text-xs">{e.action}</Td>
              <Td className="font-mono text-xs">{e.entity_id}</Td>
              <Td className="text-xs">{e.note}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

async function loadInvoice(user: User, id: string) {
  const scope = invoiceScope(user);
  return one<Invoice>(
    `SELECT i.*, v.legal_name AS vendor_name, d.name AS department, u.full_name AS requester FROM invoices i
       LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN departments d ON d.department_id=i.department_id LEFT JOIN users u ON u.user_id=i.requester_user_id
     WHERE i.invoice_id=$${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, id],
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs muted">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RawView({ raw, file }: { raw: RawItem | null; file: string | null }) {
  if (!raw) return <p className="text-sm muted">No raw item.</p>;
  const f = raw.files.find((x) => x.file_name === file) ?? raw.files[0];
  const url = f ? `/api/raw-items/${raw.raw_item_id}/file?name=${encodeURIComponent(f.file_name)}` : null;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-xs muted"><span className="font-mono">{raw.raw_item_id}</span><Badge>{raw.kind}</Badge><span>received {dateTime(raw.received_at)}</span></div>
      {raw.kind === "email" && (
        <div className="rounded-[6px] border-2 border-border bg-surface-2 p-3">
          <div><span className="muted">From:</span> {raw.from_name} &lt;{raw.from_address}&gt;</div>
          <div><span className="muted">Subject:</span> {raw.subject}</div>
          <p className="mt-2 whitespace-pre-wrap muted">{raw.body}</p>
        </div>
      )}
      {raw.kind === "form" && <pre className="max-h-96 overflow-auto rounded-[6px] border-2 border-border bg-surface-2 p-3 text-xs">{JSON.stringify(raw.form_json, null, 2)}</pre>}
      {url && f && (f.mime_type === "application/pdf" ? <iframe src={url} className="h-[720px] w-full rounded-[6px] border-2 border-border" /> : f.mime_type.startsWith("image/") ? <img src={url} alt={f.file_name} className="w-full rounded-[6px] border-2 border-border" /> : <a href={url}>{f.file_name}</a>)}
    </div>
  );
}

function LinesTable({ lines, gls, depts, editable, currency }: { lines: InvoiceLine[]; gls: { account_number: string; name: string }[]; depts: { department_id: string; name: string }[]; editable?: boolean; currency: string }) {
  return (
    <Table head={["#", "Description", "Qty", "Unit", "Amount", "GL account", "Department", "Type"]}>
      {lines.map((l) => (
        <tr key={l.line_no}>
          <Td>{l.line_no}</Td>
          <Td>
            {l.description}
            {l.suggestion_reason && <div className="text-xs muted">Suggested: {l.suggested_gl_account ?? "—"} · {l.suggestion_reason}{l.coding_status && l.coding_status !== "suggested" && ` · ${l.coding_status}`}</div>}
          </Td>
          <Td>{l.quantity}</Td>
          <Td className="whitespace-nowrap">{money(l.unit_price, currency)}</Td>
          <Td className="whitespace-nowrap">{money(l.amount, currency)}</Td>
          <Td>
            {editable ? (
              <select name={`gl_${l.line_no}`} defaultValue={l.gl_account ?? ""} className={input}>
                <option value="">—</option>
                {gls.map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
              </select>
            ) : `${l.gl_account ?? "—"} ${gls.find((g) => g.account_number === l.gl_account)?.name ?? ""}`}
          </Td>
          <Td>
            {editable ? (
              <select name={`dept_${l.line_no}`} defaultValue={l.department_id ?? ""} className={input}>
                <option value="">—</option>
                {depts.map((x) => <option key={x.department_id} value={x.department_id}>{x.name}</option>)}
              </select>
            ) : depts.find((x) => x.department_id === l.department_id)?.name ?? "—"}
          </Td>
          <Td>
            {editable ? (
              <select name={`type_${l.line_no}`} defaultValue={l.line_type ?? "services"} className={input}>
                <option>services</option><option>goods</option>
              </select>
            ) : l.line_type}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function Taxes({ d }: { d: { subtotal: number | null; taxes: { label: string; amount: number }[]; total: number | null; currency: string } }) {
  return (
    <dl className="ml-auto w-64 space-y-1 text-sm">
      <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd>{money(d.subtotal, d.currency)}</dd></div>
      {d.taxes.map((t, i) => <div key={i} className="flex justify-between"><dt className="muted">{t.label}</dt><dd>{money(t.amount, d.currency)}</dd></div>)}
      <div className="flex justify-between border-t border-line pt-1 font-medium"><dt>Total</dt><dd>{money(d.total, d.currency)}</dd></div>
    </dl>
  );
}
