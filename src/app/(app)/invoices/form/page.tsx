import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, btn, btnLight, input } from "@/components/ui";
import { formAction } from "../../../actions";

export default async function InvoiceFormPage() {
  const user = await requireUser();
  if (!can(user, "raw.submit")) notFound();
  const vendors = await query<{ vendor_id: string; legal_name: string }>("SELECT vendor_id, legal_name FROM vendors WHERE organization_id=$1 ORDER BY legal_name", [user.organization_id]);
  return (
    <div className="max-w-3xl">
      <PageTitle sub="The form is stored as a raw item as entered. An AP clerk extracts it from the Invoices page.">Invoice form</PageTitle>
      <Card>
        <ActionForm action={formAction} className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Vendor">
                  <select name="vendor_id" className={input} required>
                    <option value="">Choose…</option>
                    {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.legal_name}</option>)}
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
                <Link href="/invoices" className={btnLight}>Cancel</Link>
              </div>
            </ActionForm>
      </Card>
    </div>
  );
}
