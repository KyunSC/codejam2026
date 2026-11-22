import { ValidationError } from "@/lib/errors";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { query, tx, nextId, one, Db } from "@/lib/db";
import { assertCan, assertMember } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { User } from "@/lib/types";

export type StoredFile = { file_name: string; mime_type: string; storage_path: string; sha256: string };

export function mimeFor(name: string) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function storeFile(rawItemId: string, fileName: string, bytes: Buffer): StoredFile {
  const dir = path.join(process.env.STORAGE_DIR!, rawItemId);
  mkdirSync(dir, { recursive: true });
  const safe = path.basename(fileName);
  const storagePath = path.join(dir, safe);
  writeFileSync(storagePath, bytes);
  return { file_name: safe, mime_type: mimeFor(safe), storage_path: storagePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function readStoredFile(f: StoredFile): Buffer {
  return readFileSync(f.storage_path);
}

export async function submitPdf(actor: User | null, fileName: string, bytes: Buffer) {
  assertCan(actor, "raw.submit");
  if (!/\.(pdf|png|jpe?g)$/i.test(fileName)) throw new ValidationError("Upload a PDF, PNG or JPEG");
  return tx(async (c) => {
    const id = await nextId("RAW", c);
    const file = storeFile(id, fileName, bytes);
    await query(
      `INSERT INTO raw_items (raw_item_id, organization_id, kind, files, submitted_by) VALUES ($1,$2,'pdf',$3,$4)`,
      [id, actor.organization_id, JSON.stringify([file]), actor.user_id],
      c,
    );
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: "raw_item.upload", entityType: "raw_item", entityId: id, after: { file_name: file.file_name, sha256: file.sha256 } });
    return id;
  });
}

const TAX_LABELS = ["GST", "HST", "QST", "PST"];
export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const cents = (n: number) => Math.round(n * 100);

// What a person types into the invoice form must be a complete, consistent invoice: a vendor of the organization that is not on hold,
// a number, valid dates, lines that multiply out, and totals that add up. The form then needs no reading.
export async function checkFormInvoice(organizationId: string, f: Record<string, unknown>) {
  const fail = (m: string) => {
    throw new ValidationError(m);
  };
  const vendor = typeof f.vendor_id === "string" && f.vendor_id
    ? await one<{ status: string }>("SELECT status FROM vendors WHERE vendor_id=$1 AND organization_id=$2", [f.vendor_id, organizationId])
    : null;
  if (!vendor) fail("Pick the vendor.");
  if (vendor!.status === "on_hold") fail("This vendor is on hold; its invoices are not accepted.");
  const number = typeof f.vendor_invoice_number === "string" ? f.vendor_invoice_number.trim() : "";
  if (!number) fail("Give the invoice number.");
  if (number.length > 50) fail("The invoice number is too long.");
  if (!isDate(f.invoice_date)) fail("Give the invoice date.");
  if (f.due_date != null && f.due_date !== "" && !isDate(f.due_date)) fail("The due date is not a date.");
  if (isDate(f.due_date) && String(f.due_date) < String(f.invoice_date)) fail("The due date is before the invoice date.");
  if (!["CAD", "USD"].includes(String(f.currency))) fail("The currency is CAD or USD.");
  if (!PROVINCES.includes(String(f.ship_to_province))) fail("Pick the province it was delivered to; the tax depends on it.");
  if (f.po_reference) {
    const po = await one<{ status: string }>(
      "SELECT status FROM purchase_orders p JOIN vendors v USING (vendor_id) WHERE p.po_id=$1 AND p.vendor_id=$2 AND v.organization_id=$3",
      [f.po_reference, f.vendor_id, organizationId],
    );
    if (!po) fail("That purchase order is not one of this vendor's.");
    if (po!.status === "closed") fail("That purchase order is closed.");
  }
  const lines = Array.isArray(f.lines) ? (f.lines as Record<string, unknown>[]) : [];
  if (!lines.length) fail("Add at least one line.");
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!String(l.description ?? "").trim()) fail(`Line ${n} needs a description.`);
    if (typeof l.quantity !== "number" || !(l.quantity > 0)) fail(`Line ${n}: the quantity is more than 0.`);
    if (typeof l.unit_price !== "number" || l.unit_price < 0) fail(`Line ${n}: the unit price is a number of 0 or more.`);
    if (typeof l.amount !== "number" || cents(l.amount) !== cents((l.quantity as number) * (l.unit_price as number))) fail(`Line ${n}: the amount is the quantity times the unit price.`);
    if (l.line_type != null && l.line_type !== "goods" && l.line_type !== "services") fail(`Line ${n}: goods or services.`);
  }
  const taxes = Array.isArray(f.taxes) ? (f.taxes as Record<string, unknown>[]) : [];
  for (const t of taxes) {
    if (!TAX_LABELS.includes(String(t.label))) fail("A tax is GST, HST, QST or PST.");
    if (typeof t.amount !== "number" || t.amount < 0) fail("A tax amount is a number of 0 or more.");
  }
  const subtotal = lines.reduce((s, l) => s + cents(l.amount as number), 0);
  if (typeof f.subtotal !== "number" || cents(f.subtotal) !== subtotal) fail("The subtotal is the sum of the lines.");
  const total = subtotal + taxes.reduce((s, t) => s + cents(t.amount as number), 0);
  if (typeof f.total !== "number" || cents(f.total) !== total) fail("The total is the subtotal plus the taxes.");
}

// A form entry: the invoice typed in by hand.
export async function submitForm(actor: User | null, form: Record<string, unknown>, opts: { scan?: { fileName: string; bytes: Buffer } } = {}) {
  assertCan(actor, "raw.submit");
  const orgId = actor.organization_id!;
  await checkFormInvoice(orgId, form);
  if (opts.scan && !/\.(pdf|png|jpe?g)$/i.test(opts.scan.fileName)) throw new ValidationError("Attach the invoice as a PDF, PNG or JPEG.");
  return tx(async (c) => {
    const id = await nextId("RAW", c);
    const files = opts.scan ? [storeFile(id, opts.scan.fileName, opts.scan.bytes)] : [];
    await query(
      `INSERT INTO raw_items (raw_item_id, organization_id, kind, form_json, files, submitted_by)
       VALUES ($1,$2,'form',$3,$4,$5)`,
      [id, orgId, JSON.stringify(form), JSON.stringify(files), actor.user_id],
      c,
    );
    await writeAudit(c, { organizationId: orgId, actor, action: "raw_item.form", entityType: "raw_item", entityId: id, after: form });
    return id;
  });
}

// A raw item of the organization, or null when it has none with this id.
export async function getRawItem(actor: User | null, organizationId: string, id: string, db?: Db) {
  assertMember(actor, organizationId, { brim: true });
  return one<RawItem>("SELECT * FROM raw_items WHERE raw_item_id = $1 AND organization_id = $2", [id, organizationId], db);
}

export type RawItem = {
  raw_item_id: string;
  organization_id: string;
  kind: "email" | "pdf" | "form";
  received_at: string;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  files: StoredFile[];
  form_json: Record<string, unknown> | null;
  submitted_by: string | null;
  status: "new" | "extracted" | "no_invoice" | "failed";
  no_invoice_reason: string | null;
  failure_reason: string | null;
  source_ref: string | null;
};
