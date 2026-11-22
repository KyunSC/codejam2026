import { readFileSync, existsSync } from "fs";
import path from "path";
import { query, tx, nextId, one } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { storeFile } from "./rawIntake.service";
import type { User } from "@/lib/types";

type InboxEmail = {
  email_id: string;
  from_name: string;
  from_address: string;
  to_address: string;
  subject: string;
  received_at: string;
  body: string;
  attachments: string[];
};

// Attachment filenames held back as a stand-in for the judges' hidden batch (one per line, # comments).
// Emails carrying any of them are left in the inbox unless INCLUDE_SEALED=1, for the sealed drill.
export function sealedNames(dir: string): Set<string> {
  const file = path.join(dir, "sealed_invoices.txt");
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

export function inboxEmails(dir: string, includeSealed = process.env.INCLUDE_SEALED === "1"): InboxEmail[] {
  const emails: InboxEmail[] = JSON.parse(readFileSync(path.join(dir, "inbox", "emails.json"), "utf8"));
  if (includeSealed) return emails;
  const sealed = sealedNames(dir);
  return emails.filter((e) => !e.attachments.some((name) => sealed.has(name)));
}

// Simulated AP inbox: the dataset's emails.json stands in for the mail server.
// Each email is stored once, as a raw email with its attachments.
export async function pollInbox(actor: User | null): Promise<{ added: number; skipped: number }> {
  assertCan(actor, "raw.poll");
  const dir = process.env.DATASET_DIR!;
  const emails = inboxEmails(dir);
  let added = 0;
  let skipped = 0;
  for (const e of emails.sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    const exists = await one("SELECT 1 FROM raw_items WHERE organization_id=$1 AND source_ref=$2", [actor.organization_id, e.email_id]);
    if (exists) {
      skipped++;
      continue;
    }
    await tx(async (c) => {
      const id = await nextId("RAW", c);
      const files = e.attachments
        .map((name) => path.join(dir, "incoming_invoices", name))
        .filter((p) => existsSync(p))
        .map((p) => storeFile(id, path.basename(p), readFileSync(p)));
      await query(
        `INSERT INTO raw_items (raw_item_id, organization_id, kind, received_at, from_name, from_address, subject, body, files, source_ref)
         VALUES ($1,$2,'email',$3,$4,$5,$6,$7,$8,$9)`,
        [id, actor.organization_id, e.received_at, e.from_name, e.from_address, e.subject, e.body, JSON.stringify(files), e.email_id],
        c,
      );
      await writeAudit(c, { organizationId: actor.organization_id, actor, action: "raw_item.poll", entityType: "raw_item", entityId: id, note: e.email_id });
    });
    added++;
  }
  return { added, skipped };
}
