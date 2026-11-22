import { one } from "@/lib/db";
import { daysBetween } from "@/lib/dates";
import { allowedEdits, containsName, levenshtein, sameName, taxNumber, vendorName } from "@/lib/normalize";
import type { CheckContext, Flag } from "./types";

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const domain = (email: string) => email.toLowerCase().split("@")[1] ?? "";
const sameAddress = (a: string, b: string) => {
  const ka = vendorName(a);
  const kb = vendorName(b);
  return levenshtein(ka, kb) <= allowedEdits(ka, kb);
};

// Every field read off the invoice, or its email, compared with the record it should agree with. A mismatch is a warning;
// the pairs that would send money elsewhere or fake who the parties are (payment account, tax numbers, sender domain, the
// organization's tax number, an unverified bank change) are fraud and block the invoice. Only a finance manager or the
// controller closes a fraud flag (parsedInvoiceReview.service.ts).
export async function fraudChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor, raw, org, db } = ctx;
  const flags: Flag[] = [];
  const fraud = (check_code: string, message: string, evidence?: Record<string, unknown>) =>
    flags.push({ check_code, category: "fraud", severity: "blocking", message, evidence });
  const warn = (check_code: string, message: string, evidence?: Record<string, unknown>) =>
    flags.push({ check_code, category: "vendor", severity: "warning", message, evidence });

  // the organization the invoice is billed to
  const billedTax = taxNumber(d.bill_to_tax_number);
  if (billedTax && org.gst_hst_number && billedTax !== taxNumber(org.gst_hst_number)) {
    fraud("bill_to_tax_mismatch", `Billed to tax number ${d.bill_to_tax_number}; ${org.legal_name}'s GST/HST number is ${org.gst_hst_number}.`,
      { expected: org.gst_hst_number, found: d.bill_to_tax_number });
  }
  if (d.bill_to_name && !containsName(d.bill_to_name, org.legal_name)) {
    warn("bill_to_name_mismatch", `Billed to "${d.bill_to_name}"; the organization is ${org.legal_name}.`, { expected: org.legal_name, found: d.bill_to_name });
  }
  if (d.currency && org.base_currency && d.currency !== org.base_currency) {
    warn("currency_mismatch", `Invoiced in ${d.currency}; the organization's currency is ${org.base_currency}.`, { expected: org.base_currency, found: d.currency });
  }

  if (!vendor) return flags;

  // where the money goes
  const account = (i: string | null, t: string | null, a: string | null) => `${i ?? "?"}-${t ?? "?"}-${a ?? "?"}`;
  const remitDiffers =
    (d.remit_account && vendor.bank_account && digits(d.remit_account) !== digits(vendor.bank_account)) ||
    (d.remit_transit && vendor.bank_transit && digits(d.remit_transit) !== digits(vendor.bank_transit)) ||
    (d.remit_institution && vendor.bank_institution && digits(d.remit_institution) !== digits(vendor.bank_institution));
  if (remitDiffers) {
    fraud("remit_bank_mismatch",
      `Invoice asks for payment to account ${account(d.remit_institution, d.remit_transit, d.remit_account)}; the vendor master has ${account(vendor.bank_institution, vendor.bank_transit, vendor.bank_account)}.`,
      { expected: account(vendor.bank_institution, vendor.bank_transit, vendor.bank_account), found: account(d.remit_institution, d.remit_transit, d.remit_account) });
  }
  if (d.remit_note && /\b(card|carte|cr[eé]dit)\b/i.test(d.remit_note) && !vendor.accepts_card_payment) {
    warn("remit_card_not_accepted", `Invoice asks for payment by card ("${d.remit_note}"); the vendor master says ${vendor.legal_name} does not accept card payments.`);
  }

  // who the vendor is
  if (d.vendor_gst_hst_number && vendor.gst_hst_number && taxNumber(d.vendor_gst_hst_number) !== taxNumber(vendor.gst_hst_number)) {
    fraud("vendor_tax_number_mismatch", `GST/HST number on the invoice is ${d.vendor_gst_hst_number}; the vendor master has ${vendor.gst_hst_number}.`,
      { expected: vendor.gst_hst_number, found: d.vendor_gst_hst_number });
  }
  if (d.vendor_qst_number && vendor.qst_number && taxNumber(d.vendor_qst_number) !== taxNumber(vendor.qst_number)) {
    fraud("vendor_qst_number_mismatch", `QST number on the invoice is ${d.vendor_qst_number}; the vendor master has ${vendor.qst_number}.`,
      { expected: vendor.qst_number, found: d.vendor_qst_number });
  }
  if (d.vendor_name && !sameName(d.vendor_name, vendor.legal_name)) {
    warn("vendor_name_mismatch", `Vendor name on the invoice is "${d.vendor_name}"; the vendor master has ${vendor.legal_name}.`, { expected: vendor.legal_name, found: d.vendor_name });
  }
  if (d.vendor_address && vendor.address && !sameAddress(d.vendor_address, vendor.address)) {
    warn("vendor_address_mismatch", `Vendor address on the invoice is "${d.vendor_address}"; the vendor master has "${vendor.address}".`, { expected: vendor.address, found: d.vendor_address });
  }
  const printedDays = d.payment_terms?.match(/\d+/)?.[0];
  const termsDays = printedDays != null ? Number(printedDays)
    : /receipt|réception/i.test(d.payment_terms ?? "") ? 0
    : d.invoice_date && d.due_date ? daysBetween(d.invoice_date, d.due_date) : null;
  if (termsDays != null && vendor.payment_terms_days != null && termsDays !== vendor.payment_terms_days) {
    warn("terms_mismatch", `Invoice terms are ${termsDays} days${d.payment_terms ? ` ("${d.payment_terms}")` : ""}; the vendor master has ${vendor.payment_terms_days} days.`,
      { expected: vendor.payment_terms_days, found: termsDays });
  }

  // the email it came in
  if (raw.kind === "email" && raw.from_address && vendor.ap_contact_email) {
    const from = raw.from_address.toLowerCase();
    const known = vendor.ap_contact_email.toLowerCase();
    if (domain(from) !== domain(known)) {
      fraud("sender_domain_mismatch", `Sent from ${raw.from_address}, at ${domain(from)}; the vendor's billing email is ${vendor.ap_contact_email}, at ${domain(known)}.`,
        { expected: known, found: from });
    } else if (from !== known) {
      warn("sender_mismatch", `Sent from ${raw.from_address}; the vendor's billing email is ${vendor.ap_contact_email}.`, { expected: known, found: from });
    }
  }

  // the vendor's bank details history
  const change = await one<{ change_id: string; requested_at: string; request_channel: string; verified_by_callback: boolean; status: string }>(
    "SELECT * FROM vendor_bank_changes WHERE vendor_id=$1 ORDER BY requested_at DESC LIMIT 1",
    [vendor.vendor_id],
    db,
  );
  // the date the change was asked for (a timestamp from the database)
  const changedOn = change ? new Date(change.requested_at).toISOString().slice(0, 10) : "";
  if (change && (!change.verified_by_callback || change.status === "pending")) {
    fraud("bank_change_unverified",
      `The vendor's bank details changed on ${changedOn} by ${change.request_channel.replace(/_/g, " ")}, with no callback verification (${change.change_id}). Payment is held until it is verified.`);
  } else if (change && d.invoice_date) {
    const days = daysBetween(changedOn, d.invoice_date);
    if (days >= 0 && days <= 30) {
      warn("bank_change_recent", `The vendor's bank details changed on ${changedOn} (${change.change_id}), ${days} days before the invoice date.`);
    }
  }
  return flags;
}
