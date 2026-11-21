/**
 * Ingests the unsealed AP inbox (`inbox/emails.open.json` and `incoming_invoices/`) into the
 * database: intake for every open email, then optionally run.ts on the drafts.
 *
 * Sealed emails are skipped by attachment name, and no sealed file is ever read. Running it
 * again changes nothing: every file is already received and every label already set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { datasetDir, loadEmails } from "../dataset";
import type { Extractor } from "./extract";
import { ingestEmails, type EmailOutcome } from "./intake";
import { createLabeller, type EmailLabeller } from "./label";
import { runPipeline, type EndState, type RunOutcome } from "./run";
import { partitionInbox, sealedFileNames } from "./sealed";
import type { Db, InTransaction } from "./tx";

export interface InboxIngestOptions {
  labeller?: EmailLabeller;
  /** Also run extraction and normalisation on the drafts. */
  run?: boolean;
  extractor?: Extractor;
  inTransaction?: InTransaction;
}

export interface InboxIngestReport {
  emails: number;
  sealedEmailsSkipped: number;
  draftsCreated: number;
  alreadyReceived: number;
  missingFiles: string[];
  labels: Record<string, string | null>;
  draftsByEmail: Record<string, string[]>;
  ends: Partial<Record<EndState, number>>;
  outcomes: EmailOutcome[];
  runOutcomes: RunOutcome[];
}

export async function ingestInbox(db: Db, opts: InboxIngestOptions = {}): Promise<InboxIngestReport> {
  const sealed = sealedFileNames();
  const { open, sealed: held } = partitionInbox(loadEmails(), sealed);
  const dir = path.join(datasetDir(), "incoming_invoices");
  const readFile = (name: string): Uint8Array | null => {
    if (sealed.has(name) || name !== path.basename(name)) throw new Error(`Refusing to read ${name}`);
    try {
      return new Uint8Array(readFileSync(path.join(dir, name)));
    } catch {
      return null;
    }
  };

  const outcomes = await ingestEmails(db, open, {
    readFile,
    labeller: opts.labeller ?? createLabeller(),
    inTransaction: opts.inTransaction,
  });

  const runOutcomes = opts.run
    ? await runPipeline(db, { extractor: opts.extractor, inTransaction: opts.inTransaction })
    : [];

  const attachments = outcomes.flatMap((o) => o.attachments);
  const ends: InboxIngestReport["ends"] = {};
  for (const r of runOutcomes) ends[r.end] = (ends[r.end] ?? 0) + 1;
  return {
    emails: open.length,
    sealedEmailsSkipped: held.length,
    draftsCreated: attachments.filter((a) => a.status === "draft").length,
    alreadyReceived: attachments.filter((a) => a.status === "already_received").length,
    missingFiles: attachments.filter((a) => a.status === "missing_file").map((a) => a.fileName),
    labels: Object.fromEntries(outcomes.filter((o) => o.label).map((o) => [o.emailId, o.label!.label])),
    draftsByEmail: Object.fromEntries(
      outcomes
        .filter((o) => o.attachments.length > 0)
        .map((o) => [o.emailId, o.attachments.flatMap((a) => ("invoiceId" in a ? [a.invoiceId] : []))]),
    ),
    ends,
    outcomes,
    runOutcomes,
  };
}
