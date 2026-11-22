import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, btn, input } from "@/components/ui";
import { onboardVendorAction } from "../../../actions";

export default async function NewVendorPage() {
  const user = await requireUser();
  if (!can(user, "vendor.onboard")) notFound();
  const gls = await query<{ account_number: string; name: string }>("SELECT account_number, name FROM gl_accounts WHERE organization_id=$1 AND account_type='expense' ORDER BY 1", [user.organization_id]);
  const text = (name: string, label: string, required = false) => <Field label={label}><input name={name} className={input} required={required} /></Field>;
  return (
    <div className="max-w-3xl">
      <PageTitle sub="The vendor is created as pending review; the finance manager approves it before its invoices can be paid.">Onboard a vendor</PageTitle>
      <Card>
        <ActionForm action={onboardVendorAction} className="grid grid-cols-2 gap-3">
          {text("legal_name", "Legal name", true)}
          {text("category", "Category")}
          <Field label="Default GL account">
            <select name="default_gl_account" className={input}>
              <option value="">—</option>
              {gls.map((g) => <option key={g.account_number} value={g.account_number}>{g.account_number} {g.name}</option>)}
            </select>
          </Field>
          {text("address", "Address")}
          {text("province_or_state", "Province / state")}
          <Field label="Country"><select name="country" className={input}><option>CA</option><option>US</option></select></Field>
          {text("gst_hst_number", "GST/HST number")}
          {text("qst_number", "QST number")}
          {text("payment_terms_days", "Payment terms (days)")}
          <Field label="Pays by"><select name="preferred_payment_method" className={input}><option>EFT</option><option>CHEQUE</option><option>CARD</option></select></Field>
          {text("bank_institution", "Bank institution")}
          {text("bank_transit", "Transit")}
          {text("bank_account", "Account")}
          {text("ap_contact_email", "Billing email")}
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="requires_po" /> Requires a PO</label>
          <div className="col-span-2"><button className={btn}>Create vendor</button></div>
        </ActionForm>
      </Card>
    </div>
  );
}
