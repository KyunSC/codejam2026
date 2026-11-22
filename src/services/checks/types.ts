import type { Db } from "@/lib/db";
import type { InvoiceData } from "@/lib/types";
import type { RawItem } from "../rawIntake.service";

export type Vendor = {
  vendor_id: string;
  legal_name: string;
  category: string | null;
  country: string | null;
  gst_hst_number: string | null;
  qst_number: string | null;
  bank_institution: string | null;
  bank_transit: string | null;
  bank_account: string | null;
  ap_contact_email: string | null;
  requires_po: boolean;
  status: "active" | "pending_review" | "on_hold";
};

export type CheckContext = {
  db: Db;
  organizationId: string;
  org: { legal_name: string; gst_hst_number: string | null };
  data: InvoiceData;
  parsedInvoiceId: string;
  sha256: string | null;
  raw: RawItem;
  vendor: Vendor | null;
  asOf: string;
};

export type Flag = {
  check_code: string;
  category: "extraction" | "vendor" | "po" | "contract" | "tax" | "math" | "date" | "policy" | "fraud" | "duplicate";
  severity: "info" | "warning" | "blocking";
  message: string;
  line_no?: number;
  evidence?: Record<string, unknown>;
  related_invoice_id?: string;
  related_card_txn_ref?: string;
};

