import { defineConfig, devices } from "@playwright/test";

// Runs scripts/try-topics.ts and scripts/make-demos.ts with Playwright's TS runner.
// The dev server inherits this shell's env: with no ANTHROPIC_API_KEY (or FAKE_MODEL=1)
// it uses the offline stand-in; with a key it calls Claude.
export default defineConfig({
  testDir: ".",
  testMatch: ["try-topics.ts", "make-demos.ts"],
  timeout: 15 * 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: "..",
  },
});
