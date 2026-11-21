// Regenerates data/demos/{pendulum,falling}.json with the real model, through the UI, so each
// demo is code that actually reached `ready` in the sandbox. Run: npm run make-demos
// NEEDS A KEY: in stand-in mode it refuses, so the hand-made placeholders aren't overwritten
// by fixtures.
import { expect, test } from "@playwright/test";

const DEMOS = [
  { slug: "pendulum", prompt: "Does a heavier pendulum bob swing faster?" },
  { slug: "falling", prompt: "Does a heavier ball fall faster than a light one?" },
];

test("make demos", async ({ page, request }) => {
  const { standIn } = (await (await request.get("/api/status")).json()) as { standIn: boolean };
  test.skip(standIn, "Needs ANTHROPIC_API_KEY (stand-in mode would just copy fixtures). Placeholders left as they are.");

  for (const demo of DEMOS) {
    await page.goto("/");
    await page.getByTestId("prompt-input").fill(demo.prompt);
    // The sim is saved on ready; capture exactly what was saved.
    const saved = page.waitForRequest((r) => r.url().endsWith("/api/sims") && r.method() === "POST", { timeout: 10 * 60_000 });
    await page.getByTestId("create-button").click();
    const panel = page.getByTestId("sim-panel");
    await expect(panel).toHaveAttribute("data-state", /^(ready|failed)$/, { timeout: 10 * 60_000 });
    if ((await panel.getAttribute("data-state")) !== "ready") throw new Error(`"${demo.prompt}" failed; demo not updated.`);
    const body = (await saved).postDataJSON() as Record<string, unknown>;
    const res = await request.post("/api/demos", { data: { ...body, slug: demo.slug } });
    expect(res.status(), await res.text()).toBe(201);
    console.log(`saved data/demos/${demo.slug}.json: ${String(body.title)}`);
  }
});
