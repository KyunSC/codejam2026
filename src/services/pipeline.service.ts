import { ConflictError, NotFoundError } from "@/lib/errors";
import { tx, query, one, nextId, Db } from "@/lib/db";
import { assertMember } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { InvoiceData, User } from "@/lib/types";
import type { RawItem } from "./rawIntake.service";
import { inspectFile } from "./fileInspection.service";
import { classifyEmail, extractDocument, toInvoiceData, EXTRACTION_MODEL } from "./extraction.service";
import { resolve } from "./resolution.service";
import { buildContext, runChecks } from "./validation.service";
import type { Flag } from "./checks/types";

type Found = { file_name: string | null; sha256: string | null; data: InvoiceData; language: string | null; model: string | null; extra: Flag[] };

// an invoice with nothing read yet; a form fills in what it has
export const EMPTY: InvoiceData = {
  document_type: "invoice", vendor_name: null, vendor_address: null, vendor_gst_hst_number: null, vendor_qst_number: null,
  vendor_invoice_number: null, invoice_date: null, due_date: null, payment_terms: null, po_reference: null, credit_note_reference: null,
  bill_to_name: null, bill_to_address: null, bill_to_tax_number: null, currency: "CAD", subtotal: null, taxes: [], total: null,
  remit_institution: null, remit_transit: null, remit_account: null, remit_note: null, lines: [],
};

// Step 2, run by the system as soon as a raw item is stored: a form is already an invoice; an upload or an email's attachments
// are read by Claude. Steps 3–5 follow for each invoice found. A raw item that failed before is read again.
export async function readRawItem(organizationId: string, rawItemId: string): Promise<{ parsed: string[]; noInvoice?: string }> {
  const raw = await one<RawItem>("SELECT * FROM raw_items WHERE raw_item_id=$1 AND organization_id=$2", [rawItemId, organizationId]);
  if (!raw) throw new NotFoundError("No such raw item");
  if (raw.status !== "new" && raw.status !== "failed") throw new ConflictError("Already read");
  const actor = null;

  const found: Found[] = [];
  let noInvoice: string | null = null;

  if (raw.kind === "form") {
    found.push({ file_name: null, sha256: null, data: { ...EMPTY, ...(raw.form_json as Partial<InvoiceData>) }, language: null, model: null, extra: [] });
  } else if (raw.files.length === 0) {
    const c = await classifyEmail(raw.subject ?? "", raw.body ?? "");
    noInvoice = `${c.category.replace(/_/g, " ")}: ${c.reason}`;
  } else {
    const reasons: string[] = [];
    const email = raw.kind === "email" ? { from: [raw.from_name, raw.from_address && `<${raw.from_address}>`].filter(Boolean).join(" "), subject: raw.subject, body: raw.body } : undefined;
    for (const f of raw.files) {
      const ins = inspectFile(f);
      if (!ins.readable) {
        found.push({ file_name: f.file_name, sha256: f.sha256, data: EMPTY, language: null, model: null,
          extra: [{ check_code: "file_unreadable", category: "extraction", severity: "blocking", message: `${ins.reason}. Open the raw item and enter the invoice by hand.` }] });
        continue;
      }
      const e = await extractDocument(ins.kind, ins.bytes, email);
      if (!e.is_invoice) {
        reasons.push(`${f.file_name}: ${e.not_invoice_reason ?? "not an invoice"}`);
        continue;
      }
      found.push({ file_name: f.file_name, sha256: f.sha256, data: toInvoiceData(e), language: e.language, model: EXTRACTION_MODEL, extra: [] });
    }
    if (!found.length) noInvoice = reasons.join("; ") || "No invoice in the attachments";
  }

  return tx(async (c) => {
    if (noInvoice) {
      await query("UPDATE raw_items SET status='no_invoice', no_invoice_reason=$2, failure_reason=NULL, extracted_at=now() WHERE raw_item_id=$1", [raw.raw_item_id, noInvoice], c);
      await writeAudit(c, { organizationId: raw.organization_id, actor, action: "raw_item.no_invoice", entityType: "raw_item", entityId: raw.raw_item_id, note: noInvoice });
      return { parsed: [], noInvoice };
    }
    const ids: string[] = [];
    for (const f of found) {
      const id = await nextId("PRS", c);
      await query(
        `INSERT INTO parsed_invoices (parsed_invoice_id, organization_id, raw_item_id, file_name, sha256, extraction_model, extraction_language, invoice_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, raw.organization_id, raw.raw_item_id, f.file_name, f.sha256, f.model, f.language, JSON.stringify(f.data)],
        c,
      );
      await resolveAndCheck(c, id, raw, f.data, f.extra);
      await writeAudit(c, { organizationId: raw.organization_id, actor, action: "parsed_invoice.create", entityType: "parsed_invoice", entityId: id, note: f.file_name });
      ids.push(id);
    }
    await query("UPDATE raw_items SET status='extracted', failure_reason=NULL, extracted_at=now() WHERE raw_item_id=$1", [raw.raw_item_id], c);
    return { parsed: ids };
  });
}

// Steps 3–5 on one parsed invoice.
export async function resolveAndCheck(db: Db, parsedInvoiceId: string, raw: RawItem, data: InvoiceData, extra: Flag[] = []) {
  const p = await one<{ sha256: string | null }>("SELECT sha256 FROM parsed_invoices WHERE parsed_invoice_id=$1", [parsedInvoiceId], db);
  const resolved = await resolve(db, raw.organization_id, data, raw);
  await query("UPDATE parsed_invoices SET invoice_json=$2 WHERE parsed_invoice_id=$1", [parsedInvoiceId, JSON.stringify(resolved)], db);
  const ctx = await buildContext(db, raw.organization_id, parsedInvoiceId, p?.sha256 ?? null, resolved, raw);
  const keepExtraction = extra.length
    ? extra
    : (await query<Flag & { evidence_json: unknown }>("SELECT check_code, category, severity, message FROM invoice_flags WHERE parsed_invoice_id=$1 AND category='extraction'", [parsedInvoiceId], db));
  await runChecks(ctx, keepExtraction);
  return resolved;
}

// A parsed invoice of the organization, or null when it has none with this id.
export async function getParsed(actor: User | null, organizationId: string, id: string, db?: Db) {
  assertMember(actor, organizationId, { brim: true });
  return one<ParsedInvoice>("SELECT * FROM parsed_invoices WHERE parsed_invoice_id=$1 AND organization_id=$2", [id, organizationId], db);
}

export type ParsedInvoice = {
  parsed_invoice_id: string;
  organization_id: string;
  raw_item_id: string;
  file_name: string | null;
  sha256: string | null;
  extraction_model: string | null;
  extraction_language: string | null;
  invoice_json: InvoiceData;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  invoice_id: string | null;
};
