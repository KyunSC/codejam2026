import { tx, query, one, nextId, Db } from "@/lib/db";
import { assertCan, assertOrg, ForbiddenError } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { InvoiceData, User } from "@/lib/types";
import { getRawItem, RawItem } from "./rawIntake.service";
import { inspectFile } from "./fileInspection.service";
import { classifyEmail, extractDocument, toInvoiceData, EXTRACTION_MODEL } from "./extraction.service";
import { resolve } from "./resolution.service";
import { buildContext, runChecks } from "./validation.service";
import type { Flag } from "./checks/types";

type Found = { file_name: string | null; sha256: string | null; data: InvoiceData; language: string | null; model: string | null; extra: Flag[] };

const EMPTY: InvoiceData = {
  document_type: "invoice", vendor_name: null, vendor_address: null, vendor_gst_hst_number: null, vendor_qst_number: null,
  vendor_invoice_number: null, invoice_date: null, due_date: null, payment_terms: null, po_reference: null, credit_note_reference: null,
  bill_to_name: null, bill_to_address: null, bill_to_tax_number: null, currency: "CAD", subtotal: null, taxes: [], total: null,
  remit_institution: null, remit_transit: null, remit_account: null, remit_note: null, lines: [],
};

// Step 2: the Extract button. Steps 3–5 follow for each invoice found.
export async function extract(actor: User | null, rawItemId: string): Promise<{ parsed: string[]; noInvoice?: string }> {
  assertCan(actor, actor?.role === "brim_employee" ? "org.manage" : "raw.extract");
  const raw = await getRawItem(actor, rawItemId);
  if (!raw) throw new ForbiddenError("No such raw item");
  if (raw.status !== "new") throw new ForbiddenError("Already extracted");

  const found: Found[] = [];
  let noInvoice: string | null = null;

  if (raw.kind === "form") {
    found.push({ file_name: null, sha256: null, data: { ...EMPTY, ...(raw.form_json as Partial<InvoiceData>) }, language: null, model: null, extra: [] });
  } else if (raw.files.length === 0) {
    const c = await classifyEmail(raw.subject ?? "", raw.body ?? "");
    noInvoice = `${c.category.replace(/_/g, " ")}: ${c.reason}`;
  } else {
    const reasons: string[] = [];
    for (const f of raw.files) {
      const ins = inspectFile(f);
      if (!ins.readable) {
        found.push({ file_name: f.file_name, sha256: f.sha256, data: EMPTY, language: null, model: null,
          extra: [{ check_code: "file_unreadable", category: "extraction", severity: "blocking", message: `${ins.reason}. Open the raw item and enter the invoice by hand.` }] });
        continue;
      }
      const e = await extractDocument(ins.kind, ins.bytes);
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
      await query("UPDATE raw_items SET status='no_invoice', no_invoice_reason=$2, extracted_by=$3, extracted_at=now() WHERE raw_item_id=$1", [raw.raw_item_id, noInvoice, actor.user_id], c);
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
    await query("UPDATE raw_items SET status='extracted', extracted_by=$2, extracted_at=now() WHERE raw_item_id=$1", [raw.raw_item_id, actor.user_id], c);
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

export async function getParsed(actor: User, id: string, db?: Db) {
  const p = await one<ParsedInvoice>("SELECT * FROM parsed_invoices WHERE parsed_invoice_id=$1", [id], db);
  if (p) assertOrg(actor, p.organization_id);
  return p;
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
