import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import { TAX_CODES, codeForLabel, expectedCodes, type TaxCode } from "@/lib/taxCodes";
import { get, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm } from "../components/ApiForm";
import { Card, Field, NotFound, OptionalFields, PageTitle, Table, Td, btn, btnLight, input } from "../components/ui";

export function InvoiceUpload() {
  const user = useUser();
  const navigate = useNavigate();
  if (!can(user, "raw.submit")) return <NotFound />;
  const upload = async (fd: FormData) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF or image.");
    const body = new FormData();
    body.append("file", file);
    await post(org(user, "/raw-items/uploads"), body);
    navigate("/invoices", { state: { notice: `${file.name} is submitted and is being read. Accounts payable then reviews it.` } });
  };
  return (
    <div className="max-w-2xl">
      <PageTitle sub="The file is stored as it is and read automatically; accounts payable then reviews the invoice.">Upload an invoice</PageTitle>
      <Card>
        <ApiForm submit={upload} className="space-y-4">
          <div className="dropzone">
            <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required className="block w-full text-sm" />
            <p className="muted mt-2 text-xs">PDF, PNG or JPEG</p>
          </div>
          <div className="flex gap-3">
            <button className={btn}>Upload</button>
            <Link to="/invoices" className={btnLight}>Cancel</Link>
          </div>
        </ApiForm>
      </Card>
    </div>
  );
}

const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"],
  ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];
const TAX_LABEL: Partial<Record<TaxCode, string>> = { HST13: "HST", GST5: "GST", PST7_BC: "PST", QST9975: "QST" };

type VendorChoice = { vendor_id: string; legal_name: string; status: string; payment_terms_days: number | null; country: string | null; category: string | null; requires_po: boolean };
type Line = { description: string; quantity: string; unit_price: string; line_type: "goods" | "services"; gl_account?: string; department_id?: string; suggestion?: string };
type Tax = { label: string; amount: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? 0 : Number(s));
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};

// The taxes that usually apply: by the delivery province and each line's type, none for a foreign or exempt vendor.
function usualTaxes(lines: { amount: number; line_type: "goods" | "services" }[], province: string, vendor: VendorChoice | undefined): Tax[] {
  const totals = new Map<TaxCode, number>();
  for (const l of lines) {
    const e = expectedCodes(province, l.line_type, { foreign: !!vendor && vendor.country !== "CA", exempt: vendor?.category === "Insurance" });
    for (const code of [e.gst, e.pst]) if (code && TAX_LABEL[code]) totals.set(code, (totals.get(code) ?? 0) + l.amount * TAX_CODES[code].rate);
  }
  return [...totals].map(([code, amount]) => ({ label: TAX_LABEL[code]!, amount: round2(amount).toFixed(2) }));
}

// The invoice typed in by hand: a new one on the invoice form.
export function InvoiceForm() {
  const user = useUser();
  const navigate = useNavigate();
  if (!can(user, "raw.submit")) return <NotFound />;
  const submit = async (invoice: EnteredInvoice, fd: FormData) => {
    const body = new FormData();
    body.append("invoice", JSON.stringify(invoice));
    const scan = fd.get("file");
    if (scan instanceof File && scan.size > 0) body.append("file", scan);
    await post(org(user, "/raw-items/forms"), body);
    navigate("/invoices", { state: { notice: `Invoice ${invoice.vendor_invoice_number} is submitted. Accounts payable will review it.` } });
  };
  return (
    <div className="max-w-4xl">
      <PageTitle sub="The form is the invoice: it goes straight to accounts payable's review. Amounts, taxes, totals and the due date fill in as you type; change any of them if the invoice says otherwise.">
        Invoice form
      </PageTitle>
      <Card>
        <InvoiceEntry submitLabel="Submit invoice" onSubmit={submit} cancel={<Link to="/invoices" className={btnLight}>Cancel</Link>} withCopy />
      </Card>
    </div>
  );
}

export type EnteredInvoice = Record<string, unknown> & { vendor_invoice_number: string };
// What an entry starts from: an invoice already read, when it is entered again by hand.
export type EntryStart = {
  vendor_id?: string | null; vendor_invoice_number?: string | null; invoice_date?: string | null; due_date?: string | null; currency?: string | null;
  ship_to_province?: string | null; bill_to_address?: string | null; po_id?: string | null; department_id?: string | null; requester_user_id?: string | null;
  lines?: { description: string; quantity: number; unit_price: number; line_type?: string | null; gl_account?: string | null; department_id?: string | null;
    suggested_gl_account?: string | null; suggestion_reason?: string | null }[];
  taxes?: { label: string; amount: number }[];
};

// The choices for coding an invoice: its department and requester, and each line's GL account and department. Given when
// accounts payable edits an invoice already read; the form for a new invoice has no coding.
export type Coding = { depts: { department_id: string; name: string }[]; gls: { account_number: string; name: string }[]; people: { user_id: string; full_name: string }[] };

// The invoice typed in by hand. Line amounts, taxes, totals and the due date fill in from what is typed and stay editable.
export function InvoiceEntry({ start, submitLabel, onSubmit, cancel, withCopy, coding }: {
  start?: EntryStart; submitLabel: string; onSubmit: (invoice: EnteredInvoice, fd: FormData) => Promise<string | void>; cancel: React.ReactNode; withCopy?: boolean; coding?: Coding;
}) {
  const user = useUser();
  const vendors = useLoad(() => get<VendorChoice[]>(org(user, "/vendor-choices")), "");
  const company = useLoad(() => get<{ legal_name: string }>(org(user)), "");

  const [vendorId, setVendorId] = useState(start?.vendor_id ?? "");
  const [number, setNumber] = useState(start?.vendor_invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(start?.invoice_date ?? "");
  const [dueDate, setDueDate] = useState<string | null>(start?.due_date ?? null); // null: from the vendor's payment terms
  const [currency, setCurrency] = useState(start?.currency ?? "CAD");
  const [province, setProvince] = useState(start?.ship_to_province ?? (PROVINCES.some(([p]) => p === user.work_province) ? user.work_province! : ""));
  const [address, setAddress] = useState(start?.bill_to_address ?? "");
  const [poId, setPoId] = useState(start?.po_id ?? "");
  const [departmentId, setDepartmentId] = useState(start?.department_id ?? "");
  const [requesterId, setRequesterId] = useState(start?.requester_user_id ?? "");
  const [lines, setLines] = useState<Line[]>(
    start?.lines?.length
      ? start.lines.map((l) => ({
          description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price), line_type: l.line_type === "goods" ? "goods" : "services",
          gl_account: l.gl_account ?? "", department_id: l.department_id ?? "",
          suggestion: l.suggestion_reason ? `Suggested ${l.suggested_gl_account ?? "—"}: ${l.suggestion_reason}` : undefined,
        }))
      : [{ description: "", quantity: "1", unit_price: "", line_type: "services" }],
  );
  // null: the usual taxes for the province
  const [taxes, setTaxes] = useState<Tax[] | null>(start?.taxes?.length ? start.taxes.map((t) => ({ label: TAX_LABEL[codeForLabel(t.label) as TaxCode] ?? t.label, amount: String(t.amount) })) : null);

  const pos = useLoad(
    () => (vendorId ? get<{ po_id: string; description: string; status: string }[]>(org(user, `/purchase-orders${qs({ vendor_id: vendorId })}`)) : Promise.resolve([])),
    vendorId,
  );
  const vendor = vendors.data?.find((v) => v.vendor_id === vendorId);
  const computed = lines.map((l) => ({ ...l, amount: round2(num(l.quantity) * num(l.unit_price)) }));
  const subtotal = round2(computed.reduce((s, l) => s + l.amount, 0));
  const shownTaxes = taxes ?? usualTaxes(computed, province, vendor);
  const taxTotal = round2(shownTaxes.reduce((s, t) => s + num(t.amount), 0));
  const total = round2(subtotal + taxTotal);
  const termsDue = invoiceDate && vendor?.payment_terms_days != null ? addDays(invoiceDate, vendor.payment_terms_days) : "";
  const shownDue = dueDate ?? termsDue;
  const openPos = (pos.data ?? []).filter((p) => p.status !== "closed");

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setTax = (i: number, patch: Partial<Tax>) => setTaxes(shownTaxes.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const submit = async (fd: FormData) => {
    const invoice: EnteredInvoice = {
      document_type: "invoice",
      vendor_id: vendorId || null,
      vendor_invoice_number: number.trim(),
      invoice_date: invoiceDate || null,
      due_date: shownDue || null,
      currency,
      ship_to_province: province || null,
      bill_to_name: company.data?.legal_name ?? null,
      bill_to_address: address.trim() || null,
      po_reference: poId || null,
      lines: computed.map((l, i) => ({
        line_no: i + 1, description: l.description.trim(), quantity: num(l.quantity), unit_price: num(l.unit_price), amount: l.amount, line_type: l.line_type,
        ...(coding ? { gl_account: l.gl_account || null, department_id: l.department_id || null } : {}),
      })),
      ...(coding ? { department_id: departmentId || null, requester_user_id: requesterId || null } : {}),
      subtotal,
      taxes: shownTaxes.filter((t) => num(t.amount) !== 0).map((t) => ({ label: t.label, rate: null, amount: round2(num(t.amount)) })),
      total,
      manual: ["vendor_id", "ship_to_province", ...(poId ? ["po_id"] : [])],
    };
    return onSubmit(invoice, fd);
  };

  return (
        <ApiForm submit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Vendor">
              <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPoId(""); }} className={input} required>
                <option value="">Choose…</option>
                {(vendors.data ?? []).filter((v) => v.status !== "on_hold").map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}</option>)}
              </select>
            </Field>
            <Field label="Invoice number"><input value={number} onChange={(e) => setNumber(e.target.value)} className={input} required /></Field>
            <Field label="Currency"><select value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}><option>CAD</option><option>USD</option></select></Field>
            <Field label="Invoice date"><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={input} required /></Field>
            <Field label="Delivered to (province)">
              <select value={province} onChange={(e) => setProvince(e.target.value)} className={input} required>
                <option value="">Choose…</option>
                {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            {coding && (
              <>
                <Field label="Department">
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={input}>
                    <option value="">—</option>
                    {coding.depts.map((x) => <option key={x.department_id} value={x.department_id}>{x.name}</option>)}
                  </select>
                </Field>
                <Field label="Requester">
                  <select value={requesterId} onChange={(e) => setRequesterId(e.target.value)} className={input}>
                    <option value="">— none (route by department) —</option>
                    {coding.people.map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
                  </select>
                </Field>
              </>
            )}
          </div>

          <div className="[&_td]:align-middle">
            <Table head={["Description", "Qty", "Unit price", "Type", "Amount", ""]}>
              {computed.map((l, i) => (
                <tr key={i}>
                  <Td className="w-full">
                    <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={`${input} min-w-[10rem]`} required />
                    {coding && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select value={l.gl_account ?? ""} onChange={(e) => setLine(i, { gl_account: e.target.value })} className={input} aria-label="GL account">
                          <option value="">GL account: suggested</option>
                          {coding.gls.map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
                        </select>
                        <select value={l.department_id ?? ""} onChange={(e) => setLine(i, { department_id: e.target.value })} className={input} aria-label="Line department">
                          <option value="">Department: suggested</option>
                          {coding.depts.map((x) => <option key={x.department_id} value={x.department_id}>{x.name}</option>)}
                        </select>
                        {l.suggestion && <div className="col-span-2 text-xs muted">{l.suggestion}</div>}
                      </div>
                    )}
                  </Td>
                  <Td><input type="number" step="any" min="0" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={`${input} w-16`} required /></Td>
                  <Td><input type="number" step="0.01" min="0" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} className={`${input} w-24`} required /></Td>
                  <Td>
                    <select value={l.line_type} onChange={(e) => setLine(i, { line_type: e.target.value as Line["line_type"] })} className={`${input} w-[6.5rem]`}>
                      <option value="services">services</option><option value="goods">goods</option>
                    </select>
                  </Td>
                  <Td className="whitespace-nowrap text-right">{money(l.amount, currency)}</Td>
                  <Td>{lines.length > 1 && <button type="button" className={btnLight} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>}</Td>
                </tr>
              ))}
            </Table>
            <button type="button" className={`${btnLight} mt-2`} onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", unit_price: "", line_type: ls[ls.length - 1]?.line_type ?? "services" }])}>+ Add line</button>
          </div>

          <div className="ml-auto w-full max-w-sm space-y-2 text-sm">
            <div className="flex justify-between"><span className="muted">Subtotal</span><span>{money(subtotal, currency)}</span></div>
            {shownTaxes.map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <select value={t.label} onChange={(e) => setTax(i, { label: e.target.value })} className={`${input} w-24`}>
                  {["GST", "HST", "QST", "PST"].map((x) => <option key={x}>{x}</option>)}
                </select>
                <input type="number" step="0.01" min="0" value={t.amount} onChange={(e) => setTax(i, { amount: e.target.value })} className={`${input} w-32 text-right`} />
                <button type="button" className={btnLight} onClick={() => setTaxes(shownTaxes.filter((_, j) => j !== i))} aria-label="Remove tax">✕</button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 text-xs">
              <button type="button" className={btnLight} onClick={() => setTaxes([...shownTaxes, { label: "GST", amount: "" }])}>+ Add tax</button>
              {taxes === null
                ? <span className="muted">{province ? `usual taxes for ${province}` : "pick the province for the usual taxes"}</span>
                : <button type="button" className={btnLight} onClick={() => setTaxes(null)}>↺ Usual taxes</button>}
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span>{money(total, currency)}</span></div>
          </div>

          <OptionalFields>
            <Field label={dueDate === null && termsDue ? `Due date (${vendor!.payment_terms_days} days, from the vendor's terms)` : "Due date"}>
              <div className="flex gap-1">
                <input type="date" value={shownDue} onChange={(e) => setDueDate(e.target.value)} className={`${input} min-w-0 flex-1`} />
                {dueDate !== null && termsDue && <button type="button" className={`${btnLight} shrink-0`} onClick={() => setDueDate(null)} title="Back to the vendor's terms">↺</button>}
              </div>
            </Field>
            <Field label="Purchase order">
              <select value={poId} onChange={(e) => setPoId(e.target.value)} className={input} disabled={!vendorId}>
                <option value="">{vendorId ? (openPos.length ? "— none —" : "— this vendor has no open purchase order —") : "— pick the vendor first —"}</option>
                {openPos.map((p) => <option key={p.po_id} value={p.po_id}>{p.po_id} · {p.description}</option>)}
              </select>
              {vendor?.requires_po && !poId && (
                <span className="text-xs font-normal text-flag">
                  {vendor.legal_name} requires a purchase order{openPos.length ? "; pick it here." : ", and has none open: accounts payable will hold this invoice until one exists."}
                </span>
              )}
            </Field>
            <Field label="Delivery address"><input value={address} onChange={(e) => setAddress(e.target.value)} className={input} /></Field>
            {withCopy && <Field label="Copy of the invoice"><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" className="block w-full text-sm" /></Field>}
          </OptionalFields>

          <div className="flex gap-3">
            <button className={btn}>{submitLabel}</button>
            {cancel}
          </div>
        </ApiForm>
  );
}
