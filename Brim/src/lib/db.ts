import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The shared Prisma client. Created on first use, so code that never touches the
 * database (the rules engine and its tests) does not need DATABASE_URL.
 */
export function db(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  // Kept on globalThis so one client is reused across calls and across hot reloads in dev.
  globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return globalForPrisma.prisma;
}
