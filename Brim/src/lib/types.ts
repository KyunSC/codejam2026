export type Role =
  | "brim_employee"
  | "employee"
  | "ap_clerk"
  | "approver"
  | "finance_manager"
  | "controller_admin"
  | "auditor";

export type User = {
  user_id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  title: string | null;
  department_id: string | null;
  manager_id: string | null;
  role: Role;
  approval_limit_cad: number | null;
  work_province: string | null;
  status: "active" | "on_leave" | "terminated";
  status_since: string | null;
  delegate_user_id: string | null;
};

export type TaxLine = { label: string; rate: number | null; amount: number };

export type InvoiceLine = {
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  gl_account?: string | null;
  department_id?: string | null;
  gst_hst_code?: string | null;
  pst_qst_code?: string | null;
  line_type?: "goods" | "services" | null;
  suggested_gl_account?: string | null;
  suggested_department_id?: string | null;
  suggestion_source?: "exact_match" | "vendor_default" | "similar_description" | null;
  suggestion_reason?: string | null;
  suggestion_basis_invoice_id?: string | null;
  coding_status?: "suggested" | "accepted" | "changed";
  coded_by?: string | null;
  coded_at?: string | null;
};

// What extraction reads off the document, plus what resolution maps it to.
export type InvoiceData = {
  document_type: "invoice" | "credit_note";
  vendor_name: string | null;
  vendor_address: string | null;
  vendor_gst_hst_number: string | null;
  vendor_qst_number: string | null;
  vendor_invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_terms: string | null;
  po_reference: string | null;
  credit_note_reference: string | null;
  bill_to_name: string | null;
  bill_to_address: string | null;
  bill_to_tax_number: string | null;
  currency: string;
  subtotal: number | null;
  taxes: TaxLine[];
  total: number | null;
  remit_institution: string | null;
  remit_transit: string | null;
  remit_account: string | null;
  remit_note: string | null;
  lines: InvoiceLine[];
  // resolution
  vendor_id?: string | null;
  ship_to_province?: string | null;
  po_id?: string | null;
  po_candidates?: string[];
  contract_id?: string | null;
  department_id?: string | null;
  requester_user_id?: string | null;
  fx_rate_to_cad?: number;
  total_cad?: number | null;
  gst_hst_amount?: number;
  pst_qst_amount?: number;
  received_date?: string | null;
  // fields the clerk set by hand; resolution leaves them alone
  manual?: string[];
};
