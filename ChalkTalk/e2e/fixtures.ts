import { test as base, expect } from "@playwright/test";

/**
 * Every e2e test fails if the app's own console logs an error or the page throws.
 * Errors from inside the sandboxed sim (about:srcdoc) are the bridge's business: several
 * tests break sims on purpose. A test can allow more with `allowConsole`.
 */
export const test = base.extend<{ allowConsole: RegExp[]; consoleGuard: void }>({
  allowConsole: [[], { option: true }],
  consoleGuard: [
    async ({ page, allowConsole }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        if (msg.location().url.startsWith("about:srcdoc")) return;
        const text = msg.text();
        if (allowConsole.some((re) => re.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      page.on("pageerror", (err) => {
        if (err.stack?.includes("about:srcdoc")) return; // thrown inside the sandboxed sim
        problems.push(`pageerror: ${err.message}`);
      });
      await use();
      expect(problems, "the console should be clean").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
