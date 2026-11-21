/**
 * Phase 3 "done when" checks against the live local database, after
 * `npm run script -- scripts/ingest-inbox.ts`. Read-only. Exits 1 when a check fails.
 *
 *   npm run script -- scripts/check-pipeline.ts
 */
import { db } from "../src/lib/db";
import { harborlineId } from "../src/lib/pipeline/tx";
import { sealedFileNames } from "../src/lib/pipeline/sealed";

async function main() {
  const prisma = db();
  const results: Array<[string, boolean, string]> = [];
  const check = (name: string, ok: boolean, got: unknown) => results.push([name, ok, JSON.stringify(got)]);
  try {
    const organizationId = await harborlineId(prisma);
    const drafts = await prisma.invoice.findMany({
      where: { organizationId, source: "inbox" },
      select: { id: true, email: { select: { sourceId: true } }, documentId: true, status: true },
    });
    check("41 inbox drafts", drafts.length === 41, drafts.length);
    check("one draft per document", new Set(drafts.map((d) => d.documentId)).size === drafts.length, "distinct");
    check("EM-029 has two drafts", drafts.filter((d) => d.email?.sourceId === "EM-029").length === 2, "EM-029");

    const docs = await prisma.document.findMany({ where: { organizationId }, select: { fileName: true } });
    const sealed = sealedFileNames();
    const leaked = docs.filter((d) => sealed.has(d.fileName)).map((d) => d.fileName);
    check("no sealed file stored", leaked.length === 0, leaked);

    const labelled = await prisma.inboxEmail.findMany({
      where: { organizationId, sourceId: { in: ["EM-056", "EM-057", "EM-058", "EM-059"] } },
      select: { sourceId: true, label: true, linkedInvoiceId: true, linkedVendorId: true },
      orderBy: { id: "asc" },
    });
    const want = {
      "EM-056": "statement",
      "EM-057": "payment_inquiry",
      "EM-058": "missing_attachment",
      "EM-059": "other",
    };
    check(
      "EM-056..059 labelled",
      labelled.length === 4 && labelled.every((e) => e.label === want[e.sourceId as keyof typeof want]),
      labelled.map((e) => `${e.sourceId}:${e.label}`),
    );
    const em057 = labelled.find((e) => e.sourceId === "EM-057");
    check("EM-057 linked to its invoice", em057?.linkedInvoiceId === "AP-00049", em057?.linkedInvoiceId);

    const byStatus: Record<string, number> = {};
    for (const d of drafts) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    console.log(`Draft statuses: ${JSON.stringify(byStatus)}`);
  } finally {
    await prisma.$disconnect();
  }
  for (const [name, ok, got] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${got})`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
