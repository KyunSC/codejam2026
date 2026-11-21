/**
 * The sealed drill (BUILD_PLAN "Before starting"): 15 incoming files are held back as a
 * stand-in for the judges' hidden batch. Neither they nor the emails that carry them are
 * opened before the drill. Everything here works on file names only; nothing reads a file
 * in incoming_invoices/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { datasetDir, type EmailRow } from "../dataset";

/** Names listed in brim_ap_dataset/sealed_invoices.txt (comments and blank lines skipped). */
export function sealedFileNames(dir: string = datasetDir()): ReadonlySet<string> {
  const text = readFileSync(path.join(dir, "sealed_invoices.txt"), "utf8");
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#")),
  );
}

/** An email is sealed when any of its attachments is a sealed file. */
export function isSealedEmail(email: Pick<EmailRow, "attachments">, sealed: ReadonlySet<string>): boolean {
  return email.attachments.some((a) => sealed.has(a));
}

/**
 * Splits the inbox into what may be opened now and what is sealed. Throws if an email mixes
 * sealed and unsealed attachments, because opening it would open a sealed file's email.
 */
export function partitionInbox<E extends Pick<EmailRow, "emailId" | "attachments">>(
  emails: ReadonlyArray<E>,
  sealed: ReadonlySet<string>,
): { open: E[]; sealed: E[] } {
  const open: E[] = [];
  const held: E[] = [];
  for (const e of emails) {
    const n = e.attachments.filter((a) => sealed.has(a)).length;
    if (n > 0 && n < e.attachments.length) {
      throw new Error(`${e.emailId} carries both sealed and unsealed attachments; split it by hand before seeding`);
    }
    (n > 0 ? held : open).push(e);
  }
  return { open, sealed: held };
}
