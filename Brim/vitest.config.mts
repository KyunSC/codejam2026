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
  },
});
