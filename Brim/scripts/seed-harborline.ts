/**
 * Creates the Harborline Logistics organization and its 40 users from the dataset, each able to
 * log in with the demo password (SEED_PASSWORD, default "harborline").
 *   npm run script -- scripts/seed-harborline.ts
 *
 * Goes through the same service functions as the API, so every row gets its audit event
 * (actor "brim_admin"). If the organization already exists, it only gives a password to
 * dataset users who have none.
 */
import { db } from "../src/lib/db";
import { loadUsers } from "../src/lib/dataset";
import { createOrganization } from "../src/lib/organizations/service";
import { createUser, updateUser } from "../src/lib/users/service";

const actor = { type: "brim_admin" } as const;
const password = process.env.SEED_PASSWORD || "harborline";

async function main() {
  const rows = loadUsers();
  const existing = await db().organization.findUnique({ where: { slug: "harborline" } });
  if (existing) {
    let set = 0;
    for (const r of rows) {
      const u = await db().user.findFirst({ where: { organizationId: existing.id, externalId: r.userId } });
      if (u && !u.passwordHash) {
        await updateUser(existing.id, actor, u.id, { password });
        set++;
      }
    }
    console.log(`harborline already exists; gave the demo password to ${set} users.`);
    return;
  }
  const org = await createOrganization({ slug: "harborline", name: "Harborline Logistics Inc." });

  // Managers before the people who report to them, so managerId always resolves.
  const done = new Set<string>();
  while (done.size < rows.length) {
    const ready = rows.filter((r) => !done.has(r.userId) && (!r.managerId || done.has(r.managerId)));
    if (ready.length === 0) throw new Error("users.csv: a manager chain loops or names a missing user");
    for (const r of ready) {
      await createUser(org.id, actor, {
        externalId: r.userId,
        fullName: r.fullName,
        email: r.email,
        title: r.title,
        departmentId: r.departmentId,
        role: r.role,
        approvalLimitCad: r.approvalLimitCad.toFixed(2),
        workProvince: r.workProvince,
        status: r.status,
        statusSince: r.statusSince,
        hireDate: r.hireDate,
        managerId: r.managerId,
        password,
      });
      done.add(r.userId);
    }
  }

  // Delegates can point anywhere in the tree, so they go in once everyone exists.
  for (const r of rows.filter((r) => r.delegateUserId)) {
    await updateUser(org.id, actor, r.userId, { delegateId: r.delegateUserId });
  }

  console.log(`Created ${org.slug} (${org.id}) with ${rows.length} users.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
