/**
 * Day-one state (BUILD_PLAN Payments): stores the history replay's flags on the invoices still
 * unpaid on 2026-11-02, so AP-00407 (duplicate of AP-00394) and AP-00426 (unverified bank change)
 * show as held on the payments dashboard. Idempotent. Local database only.
 *
 *   npm run script -- scripts/day-one.ts
 */
import { loadDataset } from "../src/lib/dataset";
import { db } from "../src/lib/db";
import { harborlineId } from "../src/lib/pipeline/tx";
import { replayHistory } from "../src/lib/rules/replay";
import { today } from "../src/lib/today";
import { flagOpenHistory } from "../src/lib/workflow/payments";

async function main() {
  const prisma = db();
  try {
    const organizationId = await harborlineId(prisma);
    const replay = replayHistory(loadDataset(), today()).results;
    const n = await prisma.$transaction((tx) => flagOpenHistory(tx, organizationId, replay), { timeout: 60_000 });
    console.log(`Day-one flags created: ${n}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
