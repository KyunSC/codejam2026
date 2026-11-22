import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { query, tx, nextId, one, Db } from "@/lib/db";
import { assertCan, assertOrg } from "@/lib/authz";
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

// A form entry: the invoice typed in by hand. `submittedBy` lets an import record whose form it was.
export async function submitForm(actor: User | null, form: Record<string, unknown>, opts: { submittedBy?: string; receivedAt?: string; organizationId?: string } = {}) {
  assertCan(actor, actor?.role === "brim_employee" ? "org.manage" : "raw.submit");
  const orgId = actor.role === "brim_employee" ? opts.organizationId! : actor.organization_id!;
  return tx(async (c) => {
    const id = await nextId("RAW", c);
    await query(
      `INSERT INTO raw_items (raw_item_id, organization_id, kind, form_json, submitted_by, received_at)
       VALUES ($1,$2,'form',$3,$4,COALESCE($5::timestamptz, now()))`,
      [id, orgId, JSON.stringify(form), opts.submittedBy ?? actor.user_id, opts.receivedAt ?? null],
      c,
    );
    await writeAudit(c, { organizationId: orgId, actor, action: "raw_item.form", entityType: "raw_item", entityId: id, after: form });
    return id;
  });
}

export async function getRawItem(actor: User, id: string, db?: Db) {
  const row = await one<RawItem>("SELECT * FROM raw_items WHERE raw_item_id = $1", [id], db);
  if (row) assertOrg(actor, row.organization_id);
  return row;
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
  status: "new" | "extracted" | "no_invoice";
  no_invoice_reason: string | null;
  source_ref: string | null;
};
