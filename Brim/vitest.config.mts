import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Pin "today" to the dataset's as-of date so date checks match BUILD_PLAN without a .env.
    env: { APP_TODAY: "2026-11-02" },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // The database tests share one local database, and every audit write takes the organization's
    // hash-chain lock (src/lib/audit.ts), so test files run one at a time.
    fileParallelism: false,
  },
});
