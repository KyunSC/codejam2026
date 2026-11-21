// Wipes the database and loads the Harborline dataset.
//   npx prisma db seed        (or: npm run db:seed)
// With BRIM_LOCAL_DB_ONLY=1, db() refuses any database that is not on localhost.
import { db } from "../src/lib/db";
import { seed } from "../src/lib/seed";

async function main() {
  const started = Date.now();
  const counts = await seed(db());
  for (const [table, n] of Object.entries(counts)) console.log(`${table.padEnd(18)} ${n}`);
  console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db().$disconnect());
