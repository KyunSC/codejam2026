import type { Prisma } from "@/generated/prisma/client";
import type { Dataset } from "../dataset";
import { userRows } from "./reference";

/** Reuse existing logins and translate the CSV's user IDs to this organization's database IDs. */
export async function seedUsers(
  tx: Prisma.TransactionClient,
  ds: Dataset,
  organizationId: string,
  passwordHash: string,
): Promise<Dataset> {
  const users = new Map<string, string>();
  const created = new Set<string>();
  for (const row of userRows(ds)) {
    const { id: externalId, ...fields } = row;
    if (!externalId) throw new Error("Dataset user has no external ID");
    const existing =
      (await tx.user.findUnique({ where: { organizationId_externalId: { organizationId, externalId } } })) ??
      (await tx.user.findUnique({ where: { organizationId_email: { organizationId, email: fields.email } } }));
    if (existing?.externalId && existing.externalId !== externalId) {
      throw new Error(`Dataset user ${externalId} conflicts with an existing Harborline login.`);
    }
    const user =
      existing ??
      (await tx.user.create({
        data: { ...fields, managerId: null, delegateId: null, externalId, organizationId, passwordHash },
      }));
    if (existing && (!existing.externalId || !existing.passwordHash)) {
      await tx.user.update({
        where: { id: existing.id, organizationId },
        data: {
          externalId,
          passwordHash: existing.passwordHash ?? passwordHash,
        },
      });
    }
    users.set(externalId, user.id);
    if (!existing) created.add(externalId);
  }
  const id = (external: string) => {
    const key = users.get(external);
    if (!key) throw new Error(`Unknown dataset user ${external}`);
    return key;
  };
  for (const row of ds.users) {
    if (created.has(row.userId))
      await tx.user.update({
        where: { organizationId, id: id(row.userId) },
        data: {
          managerId: row.managerId && id(row.managerId),
          delegateId: row.delegateUserId && id(row.delegateUserId),
        },
      });
  }
  return {
    ...ds,
    users: ds.users.map((r) => ({ ...r, userId: id(r.userId) })),
    departments: ds.departments.map((r) => ({ ...r, managerUserId: id(r.managerUserId) })),
    bankChanges: ds.bankChanges.map((r) => ({ ...r, changedByUserId: id(r.changedByUserId) })),
    purchaseOrders: ds.purchaseOrders.map((r) => ({
      ...r,
      requesterUserId: id(r.requesterUserId),
      approvedBy: id(r.approvedBy),
    })),
    invoices: ds.invoices.map((r) => ({ ...r, requesterUserId: id(r.requesterUserId) })),
    approvals: ds.approvals.map((r) => ({ ...r, approverUserId: id(r.approverUserId) })),
    payments: ds.payments.map((r) => ({
      ...r,
      preparedBy: id(r.preparedBy),
      releasedBy: r.releasedBy && id(r.releasedBy),
    })),
    cardTransactions: ds.cardTransactions.map((r) => ({ ...r, cardholderUserId: id(r.cardholderUserId) })),
  };
}
