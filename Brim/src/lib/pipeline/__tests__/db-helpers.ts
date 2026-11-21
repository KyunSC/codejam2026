/**
 * Database test helpers. Everything runs inside one transaction that is always rolled back,
 * and starts by putting intake back to the seeded state inside it, so the tests give the same
 * answers whether or not the inbox has been ingested into the local database.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

class Rollback extends Error {}

/** Undoes intake and run.ts (in the caller's transaction): the database as the seed left it. */
export async function resetIntake(tx: Prisma.TransactionClient): Promise<void> {
  await tx.invoice.deleteMany({ where: { source: { not: "history" } } });
  await tx.inboxEmail.deleteMany({ where: { source: { not: "inbox" } } });
  await tx.inboxEmail.updateMany({
    data: { label: null, labelReason: null, labelSource: null, linkedInvoiceId: null, linkedVendorId: null },
  });
  await tx.document.deleteMany({ where: { url: null } });
  await tx.document.updateMany({ data: { pageCount: null, textLayer: null } });
}

/** Runs `fn` on a seeded-state view of the database and rolls everything back. */
export async function inRollback(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
  timeout = 60_000,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await resetIntake(tx);
        await fn(tx);
        throw new Rollback();
      },
      { timeout },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
