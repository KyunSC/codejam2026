/**
 * The seed: wipes every table and loads the Harborline dataset (BUILD_PLAN phase 1).
 *
 * This is the only code path that drops data. It runs through db(), so with
 * BRIM_LOCAL_DB_ONLY=1 it refuses any database that is not on localhost.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDataset } from "../dataset";
import { seedReference } from "./reference";

/** Every table in the schema. Truncated together, so foreign keys need no ordering. */
const TABLES = [
  "AuditEvent",
  "Flag",
  "ApprovalStep",
  "Payment",
  "InvoiceTax",
  "InvoiceLine",
  "Invoice",
  "InboxEmail",
  "Document",
  "PolicyRule",
  "CardTransaction",
  "BankStatementLine",
  "FxRate",
  "PurchaseOrder",
  "Contract",
  "BankChangeRequest",
  "VendorBankAccount",
  "Vendor",
  "TaxCode",
  "GlAccount",
  "Department",
  "User",
] as const;

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function seed(prisma: PrismaClient): Promise<Record<string, number>> {
  const ds = loadDataset();
  await resetDatabase(prisma);
  return prisma.$transaction(async (tx) => seedReference(tx, ds), { timeout: 120_000, maxWait: 10_000 });
}
