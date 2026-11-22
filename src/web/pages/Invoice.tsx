import { useNavigate, useParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { InvoiceData, InvoiceLine, User } from "@/lib/types";
import type { RawItem } from "@/services/rawIntake.service";
import type { getInvoiceRecord, getParsedInvoiceRecord } from "@/services/read.service";
import type { TrailEvent } from "@/services/audit.service";
import type { ReviewEdit } from "@/services/parsedInvoiceReview.service";
import { ApiError, get, patch, post, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { A, Badge, Card, Field, PageTitle, Show, Status, Table, Td, btn, btnDanger, btnLight, date, dateTime, input } from "../components/ui";

type InvoiceRecord = Awaited<ReturnType<typeof getInvoiceRecord>>;
type ParsedRecord = Awaited<ReturnType<typeof getParsedInvoiceRecord>>;

// A record the user may not see (404) is left out of the screen.
const unlessHidden = <T,>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

// One invoice: the raw item beside the parsed invoice, the clerk's review, flags, approval chain, payment and audit trail.
// The id is a parsed invoice (PRS-…) or an invoice.
export function Invoice() {
  const user = useUser();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const load = useLoad(async () => {
    let invoice: InvoiceRecord | null = null;
    let parsed: ParsedRecord | null = null;
    // a submission not yet read: the raw item on its own
    if (id.startsWith("RAW-")) {
      const [raw, vendors] = await Promise.all([
        get<RawItem>(org(user, `/raw-items/${id}`)),
        get<{ vendor_id: string; legal_name: string; status: string }[]>(org(user, "/vendor-choices")),
      ]);
      return { invoice, parsed, raw, audit: [] as TrailEvent[], vendors, depts: [], gls: [], people: [] as User[] };
    }
    if (id.startsWith("PRS-")) {
      parsed = await get<ParsedRecord>(org(user, `/parsed-invoices/${id}`));
      if (parsed.invoice_id) invoice = await unlessHidden(get<InvoiceRecord>(org(user, `/invoices/${parsed.invoice_id}`)));
    } else {
      invoice = await get<InvoiceRecord>(org(user, `/invoices/${id}`));
      if (invoice.parsed_invoice_id) parsed = await unlessHidden(get<ParsedRecord>(org(user, `/parsed-invoices/${invoice.parsed_invoice_id}`)));
    }
    const [raw, audit, vendors, depts, gls, users] = await Promise.all([
      parsed ? unlessHidden(get<RawItem>(org(user, `/raw-items/${parsed.raw_item_id}`))) : null,
      get<TrailEvent[]>(org(user, invoice ? `/invoices/${invoice.invoice_id}/audit-events` : `/parsed-invoices/${parsed!.parsed_invoice_id}/audit-events`)),
      get<{ vendor_id: string; legal_name: string; status: string }[]>(org(user, "/vendor-choices")),
      get<{ department_id: string; name: string }[]>(org(user, "/departments")),
      get<{ account_number: string; name: string }[]>(org(user, "/gl-accounts?account_type=expense")),
      get<User[]>(org(user, "/users")),
    ]);
    const people = users.filter((u) => u.status !== "terminated");
    return { invoice, parsed, raw, audit, vendors, depts, gls, people };
  }, id);
  const after = (msg: string) => {
    load.reload();
    return msg;
  };

  return (
    <Show load={load}>
      {({ invoice, parsed, raw, audit, vendors, depts, gls, people }) => {
        const flags = parsed?.flags ?? [];
        const steps = invoice?.approvals ?? [];
        const payments = invoice?.payments ?? [];
        const reviewing = parsed?.status === "pending" && can(user, "parsed.review");
        const d = parsed?.invoice_json;
        const vendorName = (vid: string | null | undefined) => vendors.find((v) => v.vendor_id === vid)?.legal_name;
        const title = invoice
          ? `${invoice.invoice_id} · ${invoice.vendor_name} ${invoice.vendor_invoice_number}`
          : parsed
            ? `${parsed.parsed_invoice_id} · ${vendorName(d?.vendor_id) ?? d?.vendor_name ?? "Unknown vendor"} ${d?.vendor_invoice_number ?? ""}`
            : `${raw!.raw_item_id} · ${raw!.kind === "form" ? `form ${raw!.form_json?.vendor_invoice_number ?? ""}` : raw!.kind === "pdf" ? raw!.files[0]?.file_name ?? "upload" : raw!.subject ?? "email"}`;
        const mySteps = steps.filter((s) => s.can_act);

        const saveReview = async (fd: FormData) => {
          const header: ReviewEdit["header"] = {};
          for (const k of ["vendor_id", "vendor_invoice_number", "invoice_date", "due_date", "department_id", "requester_user_id", "po_id", "ship_to_province"] as const) {
            if (fd.has(k)) header[k] = str(fd, k);
          }
          const lines = d!.lines.map((l) => ({
            line_no: l.line_no,
            gl_account: str(fd, `gl_${l.line_no}`),
            department_id: str(fd, `dept_${l.line_no}`),
            line_type: (str(fd, `type_${l.line_no}`) ?? "services") as "goods" | "services",
          }));
          await patch(org(user, `/parsed-invoices/${parsed!.parsed_invoice_id}`), { header, lines });
          return after("Saved; checks ran again.");
        };
        const resolveFlag = (flagId: string) => async (fd: FormData) => {
          await patch(org(user, `/flags/${flagId}`), { status: str(fd, "status") ?? "resolved", note: str(fd, "note") ?? "" });
          return after("Flag updated.");
        };
        const approveParsed = async () => {
          const r = await post<{ id: string }>(org(user, `/parsed-invoices/${parsed!.parsed_invoice_id}/approve`));
          navigate(`/invoices/${r.id}`);
        };
        const rejectParsed = async (fd: FormData) => {
          await post(org(user, `/parsed-invoices/${parsed!.parsed_invoice_id}/reject`), { reason: str(fd, "reason") ?? "" });
          return after("Rejected.");
        };
        const decide = (approvalId: string) => async (fd: FormData) => {
          const rejected = str(fd, "decision") === "rejected";
          await post(org(user, `/approvals/${approvalId}/${rejected ? "reject" : "approve"}`), { comment: str(fd, "comment") });
          return after(rejected ? "Rejected." : "Approved.");
        };
        const prepare = async () => {
          await post(org(user, "/payments"), { invoice_id: invoice!.invoice_id });
          return after("Payment scheduled.");
        };

        return (
          <div className="space-y-5">
            <PageTitle sub={invoice ? <span className="flex gap-2"><Status value={invoice.status} />{invoice.is_historical && <Badge>imported history</Badge>}{invoice.type === "credit_note" && <Badge tone="violet">credit note</Badge>}</span> : <Status value={parsed?.status ?? raw?.status} />}>
              {title}
            </PageTitle>

            {/* the approver's decision comes first, above the documents */}
            {invoice && mySteps.map((s) => (
              <Card key={s.approval_id} title={`Your decision · step ${s.step_no}${s.assigned_user_id !== user.user_id ? ` on behalf of ${s.assignee}` : ""}`}>
                <p className="mb-3 text-sm">{invoice.vendor_name} · {invoice.vendor_invoice_number} · {money(invoice.total, invoice.currency)}{invoice.department && ` · ${invoice.department}`}</p>
                <ApiForm submit={decide(s.approval_id)} className="flex flex-wrap gap-2">
                  <input name="comment" placeholder="Comment (required to reject)" className={`${input} max-w-md`} />
                  <button name="decision" value="approved" className={btn}>Approve</button>
                  <button name="decision" value="rejected" className={btnDanger}>Reject</button>
                </ApiForm>
              </Card>
            ))}
            {!parsed && raw?.no_invoice_reason && <p className="text-sm muted">No invoice found: {raw.no_invoice_reason}</p>}
            {!parsed && raw?.status === "new" && <p className="text-sm muted">Being read; the invoice appears here when it is done.</p>}
            {!parsed && raw?.status === "failed" && <p className="form-error">Could not be read: {raw.failure_reason}</p>}

            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="As received">
                <RawView raw={raw} file={parsed?.file_name ?? null} vendorName={vendorName} />
              </Card>

              <div className="space-y-5">
                {d && (
                  <Card title={invoice ? "Invoice" : "Parsed invoice"} actions={parsed?.extraction_model && <span className="text-xs muted">read by {parsed.extraction_model}{parsed.extraction_language === "fr" ? " · French" : ""}</span>}>
                    {reviewing ? (
                      <ApiForm submit={saveReview} className="space-y-4">
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
                      </ApiForm>
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
                            <ApiForm submit={resolveFlag(f.flag_id)} className="mt-2 flex gap-2">
                              <input name="note" placeholder="What you checked or decided" className={input} required />
                              <select name="status" className="input w-36"><option value="resolved">Resolved</option><option value="overridden">Override</option></select>
                              <button className={btnLight}>Save</button>
                            </ApiForm>
                          )}
                        </li>
                      ))}
                    </ul>
                    {reviewing && (
                      <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
                        <ApiForm submit={approveParsed}>
                          <button className={btn}>Approve into invoices</button>
                        </ApiForm>
                        <ApiForm submit={rejectParsed} className="flex gap-2">
                          <input name="reason" placeholder="Reason" className={input} required />
                          <button className={btnDanger}>Reject</button>
                        </ApiForm>
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
                            {s.can_act && <span className="text-xs muted">your decision, at the top</span>}
                          </Td>
                        </tr>
                      ))}
                    </Table>
                  </Card>
                )}

                {invoice && (can(user, "payment.view") || payments.length > 0) && (
                  <Card title="Payment" actions={invoice.status === "approved" && invoice.type === "invoice" && can(user, "payment.prepare") && (
                    <ApiForm submit={prepare}><button className={btn}>Prepare payment</button></ApiForm>
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

            {(invoice || parsed) && (
              <Card title="Audit trail">
                <Table head={["When", "Who", "Action", "On", "Note"]} empty="No events.">
                  {audit.map((e) => (
                    <tr key={e.event_id}>
                      <Td className="whitespace-nowrap text-xs">{dateTime(e.occurred_at)}</Td>
                      <Td>{e.actor ?? "system"}{e.actor_role && <span className="ml-1 text-xs muted">{e.actor_role.replace(/_/g, " ")}</span>}{e.on_behalf && <div className="text-xs muted">on behalf of {e.on_behalf}</div>}</Td>
                      <Td className="font-mono text-xs">{e.action}{e.channel === "agent" && <Badge tone="purple">agent</Badge>}</Td>
                      <Td className="font-mono text-xs">{e.entity_id}</Td>
                      <Td className="text-xs">{e.note}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </div>
        );
      }}
    </Show>
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

function RawView({ raw, file, vendorName }: { raw: RawItem | null; file: string | null; vendorName: (id: string | null | undefined) => string | undefined }) {
  if (!raw) return <p className="text-sm muted">No raw item.</p>;
  const f = raw.files.find((x) => x.file_name === file) ?? raw.files[0];
  const url = f ? `/api/organizations/${raw.organization_id}/raw-items/${raw.raw_item_id}/files/${encodeURIComponent(f.file_name)}` : null;
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
      {raw.kind === "form" && raw.form_json && <FormView form={raw.form_json} vendorName={vendorName} />}
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

// A submitted form as the invoice it describes.
function FormView({ form, vendorName }: { form: NonNullable<RawItem["form_json"]>; vendorName: (id: string | null | undefined) => string | undefined }) {
  const f = form as Partial<InvoiceData>;
  return (
    <div className="space-y-3 rounded-[6px] border-2 border-border bg-surface-2 p-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Item k="Vendor">{f.vendor_name ?? vendorName(f.vendor_id) ?? f.vendor_id ?? "—"}</Item>
        <Item k="Invoice number">{f.vendor_invoice_number ?? "—"}</Item>
        <Item k="Invoice date">{date(f.invoice_date)}</Item>
        <Item k="Due date">{date(f.due_date)}</Item>
        <Item k="PO">{f.po_reference ?? "—"}</Item>
        <Item k="Delivered to">{[f.ship_to_province, f.bill_to_address].filter(Boolean).join(" · ") || "—"}</Item>
      </dl>
      <Table head={["#", "Description", "Qty", "Unit", "Amount"]}>
        {(f.lines ?? []).map((l) => (
          <tr key={l.line_no}><Td>{l.line_no}</Td><Td>{l.description}</Td><Td>{l.quantity}</Td><Td>{money(l.unit_price, f.currency)}</Td><Td>{money(l.amount, f.currency)}</Td></tr>
        ))}
      </Table>
      <Taxes d={{ subtotal: f.subtotal ?? null, taxes: f.taxes ?? [], total: f.total ?? null, currency: f.currency ?? "CAD" }} />
    </div>
  );
}
