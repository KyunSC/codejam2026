/**
 * Ingests the unsealed inbox into the local database: 41 files become drafts, the four
 * attachment-less emails get labels. `--run` also extracts and normalises the drafts (with the
 * hand-made answers when there is no ANTHROPIC_API_KEY).
 *
 *   npm run script -- scripts/ingest-inbox.ts [--run]
 *
 * Safe to run twice. `npm run db:seed` returns the database to the state before intake.
 */
import { db } from "../src/lib/db";
import { hasAnthropicKey } from "../src/lib/pipeline/extract";
import { ingestInbox } from "../src/lib/pipeline/ingest";

async function main() {
  const run = process.argv.includes("--run");
  const prisma = db();
  try {
    console.log(`Model calls: ${hasAnthropicKey() ? "Claude (key set)" : "hand-made answers (no key)"}`);
    const r = await ingestInbox(prisma, { run });
    console.log(`Emails: ${r.emails} open, ${r.sealedEmailsSkipped} sealed skipped`);
    console.log(`Drafts: ${r.draftsCreated} created, ${r.alreadyReceived} already received`);
    if (r.missingFiles.length) console.log(`Missing files: ${r.missingFiles.join(", ")}`);
    const multi = Object.entries(r.draftsByEmail).filter(([, ids]) => ids.length > 1);
    for (const [email, ids] of multi) console.log(`${email}: ${ids.length} drafts (${ids.join(", ")})`);
    for (const [email, label] of Object.entries(r.labels)) console.log(`${email}: ${label ?? "not labelled"}`);
    if (run) {
      console.log(`Run: ${JSON.stringify(r.ends)}`);
      for (const o of r.runOutcomes.filter((x) => x.end !== "extracted" && x.end !== "not_extracted")) {
        console.log(`  ${o.invoiceId} ${o.fileName}: ${o.end}. ${o.detail}`);
      }
    }
    const total = await prisma.invoice.count({ where: { source: "inbox" } });
    console.log(`Inbox drafts in the database: ${total}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
