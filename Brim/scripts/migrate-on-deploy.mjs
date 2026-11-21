// Runs `prisma migrate deploy` during a Vercel production build, so the shared database always has
// every migration the code being deployed expects. Anywhere else (local builds, preview deployments,
// which would otherwise apply unmerged migrations to the shared database) it does nothing.
//
// Migrate needs Neon's direct connection, not the pooled one. It uses DATABASE_URL_UNPOOLED when set,
// else DATABASE_URL with Neon's "-pooler" host suffix removed. A failed migration fails the build,
// so the previous deployment stays live instead of new code running against an old schema.
import { spawnSync } from "node:child_process";

if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("migrate-on-deploy: not a Vercel production build; skipping migrations.");
  process.exit(0);
}

const pooled = process.env.DATABASE_URL?.trim();
let direct = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!direct && pooled) {
  const url = new URL(pooled);
  url.hostname = url.hostname.replace("-pooler.", ".");
  direct = url.toString();
}
if (!direct) {
  console.error("migrate-on-deploy: no DATABASE_URL_UNPOOLED or DATABASE_URL; cannot apply migrations.");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL_UNPOOLED: direct },
});
process.exit(result.status ?? 1);
