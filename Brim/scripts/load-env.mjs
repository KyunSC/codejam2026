// One place that decides which .env files load, for Vitest, `npm run script`, Prisma and Next.
//
// Order: Brim/.env, then the repo-root .env. The first file to set a variable wins, and a
// variable already set in the shell beats both. Paths are resolved from this file, not the
// current directory, so a command run from the repo root still reads Brim/.env first.
//
// With BRIM_LOCAL_DB_ONLY=1 (the overnight loops) the repo-root .env is skipped: it holds the
// shared Neon database and API keys, and a local run must see only Brim/.env.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const brimDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {{ skipBrimEnv?: boolean }} [options] skipBrimEnv: Next already loads Brim/.env itself. */
export function loadEnv({ skipBrimEnv = false } = {}) {
  const files = [];
  if (!skipBrimEnv) files.push(path.join(brimDir, ".env"));
  if (process.env.BRIM_LOCAL_DB_ONLY?.trim() !== "1") files.push(path.join(brimDir, "..", ".env"));
  if (files.length > 0) config({ path: files, quiet: true });
}
