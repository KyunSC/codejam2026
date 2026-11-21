/**
 * Versioned vendor bank accounts and the history's bank change requests
 * (BUILD_PLAN "Vendor management and bank changes").
 *
 * What the dataset gives:
 * - vendors.csv holds each vendor's account as of 2026-11-02, including for V004, whose
 *   change BC-009 was never verified by callback. The dataset wins: that account is the one
 *   on file, and the unverified request is what holds V004's payments.
 * - bank_change_history.csv gives only the last 4 digits of the old and new accounts.
 *
 * So each vendor gets one row per account it has had: earlier accounts carry only `last4`,
 * the current one carries the full details. Each history change becomes a request whose
 * status is `verified` when a callback was made and `pending` when not.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { BankChangeRow, Dataset } from "../dataset";
import { dateOnly } from "./convert";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface BankSeed {
  accounts: Prisma.VendorBankAccountCreateManyInput[];
  requests: Prisma.BankChangeRequestCreateManyInput[];
  /** Places where the CSVs disagree with each other; reported, not fatal. */
  warnings: string[];
}

export function bankSeedRows(ds: Pick<Dataset, "vendors" | "bankChanges">): BankSeed {
  const accounts: Prisma.VendorBankAccountCreateManyInput[] = [];
  const requests: Prisma.BankChangeRequestCreateManyInput[] = [];
  const warnings: string[] = [];

  const changesByVendor = new Map<string, BankChangeRow[]>();
  for (const c of ds.bankChanges) {
    const list = changesByVendor.get(c.vendorId) ?? [];
    list.push(c);
    changesByVendor.set(c.vendorId, list);
  }
  const vendorIds = new Set(ds.vendors.map((v) => v.vendorId));
  for (const id of changesByVendor.keys()) {
    if (!vendorIds.has(id)) warnings.push(`bank_change_history.csv names unknown vendor ${id}`);
  }

  for (const v of ds.vendors) {
    const changes = [...(changesByVendor.get(v.vendorId) ?? [])].sort((a, b) =>
      a.changedAt.localeCompare(b.changedAt),
    );
    const hasCurrent = v.bankAccount !== null;

    // Earlier accounts: known only by the last 4 digits each change replaced.
    let from = v.onboardedAt;
    for (const c of changes) {
      accounts.push({
        vendorId: v.vendorId,
        last4: c.oldAccountLast4,
        validFrom: dateOnly(from),
        validTo: dateOnly(c.changedAt),
        source: "history",
      });
      from = c.changedAt;
    }

    const last = changes.at(-1);
    if (hasCurrent) {
      const last4 = v.bankAccount!.slice(-4);
      if (last && last.newAccountLast4 !== last4) {
        warnings.push(
          `${v.vendorId}: ${last.changeId} says the new account ends ${last.newAccountLast4}, vendors.csv has …${last4}`,
        );
      }
      accounts.push({
        vendorId: v.vendorId,
        institution: v.bankInstitution,
        transit: v.bankTransit,
        account: v.bankAccount,
        last4,
        validFrom: dateOnly(last?.changedAt ?? v.bankDetailsUpdatedAt ?? v.onboardedAt),
        validTo: null,
        changeRequestId: last?.changeId ?? null,
        source: "history",
      });
    } else if (last) {
      warnings.push(`${v.vendorId} has bank changes but no bank details in vendors.csv`);
    }

    for (const c of changes) {
      const isLatest = c === last;
      requests.push({
        id: c.changeId,
        vendorId: v.vendorId,
        oldLast4: c.oldAccountLast4,
        newLast4: c.newAccountLast4,
        // Full details are known only for the change that produced today's account.
        newInstitution: isLatest && hasCurrent ? v.bankInstitution : null,
        newTransit: isLatest && hasCurrent ? v.bankTransit : null,
        newAccount: isLatest && hasCurrent ? v.bankAccount : null,
        channel: c.requestChannel,
        requestedById: c.changedByUserId,
        requestedAt: dateOnly(c.changedAt),
        status: c.verifiedByCallback ? "verified" : "pending",
        verifiedByCallback: c.verifiedByCallback,
        // The history does not say who made the callback.
        verifiedById: null,
        note: c.verifiedByCallback ? null : `Imported from history: requested by ${c.requestChannel}, no callback recorded.`,
        source: "history",
      });
    }
  }
  return { accounts, requests, warnings };
}

export async function seedBank(tx: Tx, ds: Dataset): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  const { accounts, requests, warnings } = bankSeedRows(ds);
  const counts = {
    vendorBankAccounts: (await tx.vendorBankAccount.createMany({ data: accounts })).count,
    bankChangeRequests: (await tx.bankChangeRequest.createMany({ data: requests })).count,
  };
  return { counts, warnings };
}
