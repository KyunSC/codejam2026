/**
 * Test helpers for Loop C's database tests. They run only against a local Postgres (never the
 * shared Neon database in .env), inside one transaction that is always rolled back.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { dbHost } from "@/lib/db-guard";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when DATABASE_URL points at a local database. */
export const hasLocalDb = (() => {
  const url = process.env.DATABASE_URL?.trim();
  const host = url ? dbHost(url) : null;
  return !!host && LOCAL.has(host);
})();

class Rollback extends Error {}

/** Runs `fn` in a transaction and rolls it back. */
export async function rollback(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
  timeout = 60_000,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

export async function harborline(tx: Prisma.TransactionClient): Promise<string> {
  return (await tx.organization.findUniqueOrThrow({ where: { slug: "harborline" }, select: { id: true } })).id;
}

/** The app user id for a dataset user id (U001 …). */
export async function userId(tx: Prisma.TransactionClient, organizationId: string, externalId: string): Promise<string> {
  return (await tx.user.findFirstOrThrow({ where: { organizationId, externalId }, select: { id: true } })).id;
}
