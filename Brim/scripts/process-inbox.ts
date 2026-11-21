/**
 * Runs processInvoice over every app invoice that is extracted, needs_review or coded, oldest
 * first, one transaction each, then prints file → status and flags. Local database only.
 *
 *   npm run script -- scripts/process-inbox.ts [--report-only]
 */
import { db } from "../src/lib/db";
import { harborlineId } from "../src/lib/pipeline/tx";
import { PROCESSABLE, processInvoice } from "../src/lib/workflow/process";

async function main() {
  const prisma = db();
  try {
    const organizationId = await harborlineId(prisma);
    if (!process.argv.includes("--report-only")) {
      const ids = await prisma.invoice.findMany({
        where: { organizationId, source: { not: "history" }, status: { in: [...PROCESSABLE] } },
        orderBy: [{ receivedDate: "asc" }, { id: "asc" }],
        select: { id: true, normalized: true },
      });
      for (const { id, normalized } of ids) {
        if (!normalized) continue;
        await prisma.$transaction((tx) => processInvoice(tx, { organizationId, invoiceId: id, actor: { type: "system" } }), {
          timeout: 60_000,
        });
      }
    }
    const rows = await prisma.invoice.findMany({
      where: { organizationId, source: { not: "history" } },
      orderBy: { id: "asc" },
      include: { document: { select: { fileName: true } }, flags: { where: { status: "open" } } },
    });
    for (const r of rows) {
      const flags = r.flags.map((f) => `${f.code}${f.effect === "hold" ? "*" : ""}`).sort().join(" ");
      console.log(`${r.id}  ${(r.document?.fileName ?? "-").padEnd(34)} ${(r.vendorId ?? "-").padEnd(5)} ${r.status.padEnd(13)} ${flags}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
