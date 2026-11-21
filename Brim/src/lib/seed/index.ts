import { lockIntake } from "../pipeline/intake";
import { db } from "../db";
import { assertLocalSeedTarget } from "../db-guard";
import { loadDataset } from "../dataset";
import { seedHistoryAudit } from "./audit-history";
import { seedBank } from "./bank";
import { seedHistory } from "./history";
import { seedInbox } from "./inbox";
import { hashPassword } from "../auth/password";
import { seedUsers } from "./users";
import { seedReference } from "./reference";

export async function seed(): Promise<Record<string, number>> {
  assertLocalSeedTarget();
  const dataset = loadDataset();
  const passwordHash = await hashPassword(process.env.SEED_PASSWORD || "harborline");
  return db().$transaction<Record<string, number>>(
    async (tx): Promise<Record<string, number>> => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext('brim.harborline.seed'))) AS lock`;
      const org = await tx.organization.upsert({
        where: { slug: "harborline" },
        update: {},
        create: { slug: "harborline", name: "Harborline Logistics Inc." },
      });
      if (org.datasetImportedAt) return { alreadyImported: 1 };
      await lockIntake(tx, org.id);
      const ds = await seedUsers(tx, dataset, org.id, passwordHash);
      const counts = await seedReference(tx, ds, org.id);
      const bank = await seedBank(tx, ds, org.id);
      for (const w of bank.warnings) console.warn(`seed warning: ${w}`);
      const history = await seedHistory(tx, ds, org.id);
      const audit = await seedHistoryAudit(tx, ds, org.id);
      const inbox = await seedInbox(tx, ds, org.id);
      await tx.organization.update({ where: { id: org.id }, data: { datasetImportedAt: new Date() } });
      return { ...counts, ...bank.counts, ...history, ...audit, ...inbox };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
