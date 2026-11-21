// Run a TypeScript script with the same environment as the tests:
//   npm run script -- scripts/replay.ts [args]
// Loads Brim/.env, then defaults APP_TODAY to the dataset's as-of date (2026-11-02) so
// date checks match BUILD_PLAN. A value already set in the shell or in .env wins.
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ quiet: true });
process.env.APP_TODAY ||= "2026-11-02";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npm run script -- <file.ts> [args]");
  process.exit(2);
}
const result = spawnSync("tsx", args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
