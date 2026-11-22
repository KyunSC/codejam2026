import { Link, useNavigate } from "react-router-dom";
import { can } from "@/lib/authz";
import { get, post, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { Card, Field, NotFound, PageTitle, btn, btnLight, input } from "../components/ui";

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
    navigate("/invoices");
  };
  return (
    <div className="max-w-2xl">
      <PageTitle sub="The file is stored as a raw item as it is. An AP clerk extracts it from the Invoices page.">Upload an invoice</PageTitle>
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

export function InvoiceForm() {
  const user = useUser();
  const navigate = useNavigate();
  const vendors = useLoad(() => get<{ vendor_id: string; legal_name: string }[]>(org(user, "/vendor-choices")), "");
  if (!can(user, "raw.submit")) return <NotFound />;

  // The typed fields as a one-line invoice; stored as a raw item until a clerk extracts it.
  const submit = async (fd: FormData) => {
    const amount = Number(str(fd, "amount") ?? 0);
    const tax = Number(str(fd, "tax") ?? 0);
    await post(org(user, "/raw-items/forms"), {
      document_type: "invoice",
      vendor_id: str(fd, "vendor_id"),
      vendor_invoice_number: str(fd, "vendor_invoice_number"),
      invoice_date: str(fd, "invoice_date"),
      due_date: str(fd, "due_date"),
      currency: str(fd, "currency") ?? "CAD",
      po_reference: str(fd, "po_reference"),
      bill_to_name: "Harborline Logistics Inc.",
      bill_to_address: str(fd, "bill_to_address"),
      subtotal: amount,
      taxes: tax ? [{ label: str(fd, "tax_label") ?? "GST", rate: null, amount: tax }] : [],
      total: amount + tax,
      lines: [{ line_no: 1, description: str(fd, "description") ?? "", quantity: 1, unit_price: amount, amount }],
      manual: str(fd, "vendor_id") ? ["vendor_id"] : [],
    });
    navigate("/invoices");
  };

  return (
    <div className="max-w-3xl">
      <PageTitle sub="The form is stored as a raw item as entered. An AP clerk extracts it from the Invoices page.">Invoice form</PageTitle>
      <Card>
        <ApiForm submit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor">
              <select name="vendor_id" className={input} required>
                <option value="">Choose…</option>
                {(vendors.data ?? []).map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}</option>)}
              </select>
            </Field>
            <Field label="Invoice number"><input name="vendor_invoice_number" className={input} required /></Field>
            <Field label="Invoice date"><input type="date" name="invoice_date" className={input} required /></Field>
            <Field label="Due date"><input type="date" name="due_date" className={input} /></Field>
            <Field label="Description"><input name="description" className={input} required /></Field>
            <Field label="Amount before tax"><input name="amount" type="number" step="0.01" className={input} required /></Field>
            <Field label="Tax">
              <div className="flex gap-1">
                <select name="tax_label" className={input}><option>GST</option><option>HST</option><option>QST</option><option>PST</option></select>
                <input name="tax" type="number" step="0.01" className={input} placeholder="0.00" />
              </div>
            </Field>
            <Field label="Delivered to (office)">
              <select name="bill_to_address" className={input}>
                <option value="88 Queens Quay W, Toronto ON M5J 0B8">Toronto ON</option>
                <option value="1055 W Hastings St, Vancouver BC V6E 2E9">Vancouver BC</option>
                <option value="250 6 Ave SW, Calgary AB T2P 3H7">Calgary AB</option>
                <option value="1250 Rene-Levesque O, Montreal QC H3B 4W8">Montréal QC</option>
              </select>
            </Field>
            <Field label="Currency"><select name="currency" className={input}><option>CAD</option><option>USD</option></select></Field>
            <Field label="PO (optional)"><input name="po_reference" className={input} /></Field>
          </div>
          <div className="flex gap-3">
            <button className={btn}>Save as raw item</button>
            <Link to="/invoices" className={btnLight}>Cancel</Link>
          </div>
        </ApiForm>
      </Card>
    </div>
  );
}
