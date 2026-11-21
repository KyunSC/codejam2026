import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** A database handle: the client, or a transaction client inside `$transaction`. */
export type Db = Prisma.TransactionClient | PrismaClient;

/** Runs `fn` in a transaction. Tests pass `(fn) => fn(tx)` to run a whole batch inside one rolled-back transaction. */
export type InTransaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export function transactionsOn(db: Db): InTransaction {
  if (!("$transaction" in db)) {
    throw new Error("Already inside a transaction: pass inTransaction to run the batch in it.");
  }
  return (fn) => db.$transaction(fn);
}
