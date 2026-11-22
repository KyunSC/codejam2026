import { Db, query, one } from "@/lib/db";
import { codeForLabel, isGstHst } from "@/lib/taxCodes";
import { descriptionKey, provinceFromAddress, round2, similarity, taxNumber, vendorName } from "@/lib/normalize";
import { usdToCad } from "./fxFeed.service";
import type { InvoiceData, InvoiceLine } from "@/lib/types";
import type { RawItem } from "./rawIntake.service";

type VendorRow = { vendor_id: string; legal_name: string; gst_hst_number: string | null; default_gl_account: string | null };
type PastInvoice = { invoice_id: string; vendor_id: string; department_id: string | null; lines: InvoiceLine[] };

const isManual = (d: InvoiceData, field: string) => (d.manual ?? []).includes(field);

// Step 3: link the parsed invoice to the organization's records and suggest coding for each line.
export async function resolve(db: Db, organizationId: string, input: InvoiceData, raw: RawItem): Promise<InvoiceData> {
  const d: InvoiceData = structuredClone(input);
  const vendors = await query<VendorRow>("SELECT vendor_id, legal_name, gst_hst_number, default_gl_account FROM vendors WHERE organization_id=$1", [organizationId], db);

  // Vendor: GST/HST number, then legal name.
  if (!isManual(d, "vendor_id")) {
    const num = taxNumber(d.vendor_gst_hst_number);
    const byNumber = num ? vendors.find((v) => taxNumber(v.gst_hst_number) === num) : undefined;
    const byName = vendors.filter((v) => vendorName(v.legal_name) === vendorName(d.vendor_name));
    d.vendor_id = byNumber?.vendor_id ?? (num ? null : byName.length === 1 ? byName[0].vendor_id : null) ?? d.vendor_id ?? null;
  }
  const vendor = vendors.find((v) => v.vendor_id === d.vendor_id) ?? null;

  if (!isManual(d, "ship_to_province")) d.ship_to_province = provinceFromAddress(d.bill_to_address);

  // PO: the printed reference, else the vendor's open POs as candidates.
  if (!isManual(d, "po_id")) {
    d.po_id = null;
    if (d.po_reference) {
      const po = await one<{ po_id: string }>("SELECT po_id FROM purchase_orders WHERE upper(po_id) = upper($1)", [d.po_reference.trim()], db);
      d.po_id = po?.po_id ?? null;
    }
  }
  d.po_candidates = vendor
    ? (await query<{ po_id: string }>("SELECT po_id FROM purchase_orders WHERE vendor_id=$1 AND status <> 'closed' ORDER BY issue_date", [vendor.vendor_id], db)).map((r) => r.po_id)
    : [];
  const po = d.po_id ? await one<{ department_id: string; requester_user_id: string }>("SELECT department_id, requester_user_id FROM purchase_orders WHERE po_id=$1", [d.po_id], db) : null;

  if (!isManual(d, "contract_id")) {
    const contract = vendor
      ? await one<{ contract_id: string }>(
          "SELECT contract_id FROM contracts WHERE vendor_id=$1 ORDER BY (status='active') DESC, end_date DESC NULLS LAST LIMIT 1",
          [vendor.vendor_id],
          db,
        )
      : null;
    d.contract_id = contract?.contract_id ?? null;
  }

  // Lines: GL account and department by three tiers.
  const past = await query<PastInvoice>("SELECT invoice_id, vendor_id, department_id, lines FROM invoices WHERE organization_id=$1 ORDER BY invoice_date DESC", [organizationId], db);
  const vendorPast = past.filter((p) => p.vendor_id === d.vendor_id);
  const usualDept = mostCommon(vendorPast.map((p) => p.department_id));
  const usualType = mostCommon(vendorPast.flatMap((p) => p.lines.map((l) => l.line_type ?? null)));
  const chargedGst = d.taxes.map((t) => codeForLabel(t.label)).find((c) => isGstHst(c)) ?? null;
  const chargedPst = d.taxes.map((t) => codeForLabel(t.label)).find((c) => c === "PST7_BC" || c === "QST9975") ?? null;

  d.lines = d.lines.map((line) => {
    const l: InvoiceLine = { ...line };
    const key = descriptionKey(l.description);
    let sug: { gl: string | null; dept: string | null; type: InvoiceLine["line_type"]; source: InvoiceLine["suggestion_source"]; reason: string; basis: string | null };
    const exact = vendorPast.flatMap((p) => p.lines.filter((pl) => descriptionKey(pl.description) === key).map((pl) => ({ p, pl })))[0];
    if (exact) {
      sug = { gl: exact.pl.gl_account ?? null, dept: exact.pl.department_id ?? exact.p.department_id, type: exact.pl.line_type ?? null, source: "exact_match", reason: `Same as ${exact.p.invoice_id}, line ${exact.pl.line_no}`, basis: exact.p.invoice_id };
    } else if (vendor) {
      sug = { gl: vendor.default_gl_account, dept: usualDept, type: (usualType as InvoiceLine["line_type"]) ?? "services", source: "vendor_default", reason: `default account of ${vendor.legal_name}`, basis: null };
    } else {
      let best: { p: PastInvoice; pl: InvoiceLine; s: number } | null = null;
      for (const p of past) for (const pl of p.lines) {
        const s = similarity(l.description, pl.description);
        if (s > (best?.s ?? 0)) best = { p, pl, s };
      }
      sug = best && best.s >= 0.2
        ? { gl: best.pl.gl_account ?? null, dept: best.pl.department_id ?? best.p.department_id, type: best.pl.line_type ?? null, source: "similar_description", reason: `Closest past line: "${best.pl.description}" on ${best.p.invoice_id}`, basis: best.p.invoice_id }
        : { gl: null, dept: null, type: "services", source: null, reason: "No similar past line", basis: null };
    }
    l.suggested_gl_account = sug.gl;
    l.suggested_department_id = sug.dept;
    l.suggestion_source = sug.source;
    l.suggestion_reason = sug.reason;
    l.suggestion_basis_invoice_id = sug.basis;
    if (!l.coding_status || l.coding_status === "suggested") {
      l.gl_account = sug.gl;
      l.department_id = sug.dept;
      l.line_type = l.line_type ?? sug.type ?? "services";
      l.coding_status = "suggested";
    }
    // the codes the vendor charged; the tax check compares them with what the province calls for
    if (!l.gst_hst_code) l.gst_hst_code = chargedGst;
    if (!l.pst_qst_code) l.pst_qst_code = chargedPst;
    return l;
  });

  if (!isManual(d, "department_id")) d.department_id = po?.department_id ?? mostCommon(d.lines.map((l) => l.department_id ?? null)) ?? usualDept ?? null;
  if (!isManual(d, "requester_user_id")) {
    const submitter = raw.submitted_by ? await one<{ user_id: string; role: string }>("SELECT user_id, role FROM users WHERE user_id=$1 AND organization_id=$2", [raw.submitted_by, organizationId], db) : null;
    d.requester_user_id = submitter?.user_id ?? po?.requester_user_id ?? null;
  }

  d.gst_hst_amount = round2(d.taxes.filter((t) => isGstHst(codeForLabel(t.label))).reduce((s, t) => s + t.amount, 0));
  d.pst_qst_amount = round2(d.taxes.filter((t) => !isGstHst(codeForLabel(t.label))).reduce((s, t) => s + t.amount, 0));
  const date = d.invoice_date ?? raw.received_at.slice(0, 10);
  d.fx_rate_to_cad = d.currency === "USD" ? usdToCad(date) ?? 1 : 1;
  d.total_cad = d.total == null ? null : round2(d.total * d.fx_rate_to_cad);
  d.received_date = d.received_date ?? new Date(raw.received_at).toISOString().slice(0, 10);
  return d;
}

function mostCommon<T>(xs: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  for (const x of xs) if (x != null) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best;
}
