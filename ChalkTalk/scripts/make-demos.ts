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
    await page.goto("/new");
    await page.getByTestId("tool-sim").click();
    await page.getByTestId("prompt-input").fill(demo.prompt);
    await page.getByTestId("create-button").click();
    const panel = page.getByTestId("sim-panel");
    await expect(panel).toHaveAttribute("data-state", /^(ready|failed)$/, { timeout: 10 * 60_000 });
    if ((await panel.getAttribute("data-state")) !== "ready") throw new Error(`"${demo.prompt}" failed; demo not updated.`);
    // The board saves the box's code on ready; take exactly what it saved.
    await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
    const board = (await (await request.get(`/api/boards/${page.url().split("/b/")[1]}`)).json()) as {
      items: Array<Record<string, unknown> & { kind: string }>;
    };
    const sim = board.items.find((i) => i.kind === "sim")!;
    const body = { prompt: sim.prompt, code: sim.code, title: sim.title, question: sim.question, params: sim.params };
    const res = await request.post("/api/demos", { data: { ...body, slug: demo.slug } });
    expect(res.status(), await res.text()).toBe(201);
    console.log(`saved data/demos/${demo.slug}.json: ${String(body.title)}`);
  }
});
