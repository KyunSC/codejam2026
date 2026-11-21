import { expect, test } from "@playwright/test";

test("a saved demo loads instantly with no /api/generate request", async ({ page }) => {
  const modelCalls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/(generate|repair|edit)$/.test(new URL(r.url()).pathname)) modelCalls.push(r.url());
  });
  await page.goto("/");
  const select = page.getByTestId("demos-select");
  await expect(select.locator("option")).toHaveCount(3);

  const started = Date.now();
  await select.selectOption("falling");
  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  test.info().annotations.push({ type: "demo-ready-ms", description: String(Date.now() - started) });
  await expect(page.getByTestId("sim-title")).toHaveText("Two Balls Dropped Together");
  await expect(page.locator('input[type="range"]')).toHaveCount(4);
  await expect(page.getByTestId("prompt-input")).toHaveValue("Does a heavier ball fall faster than a light one?");
  // A demo is saved as a sim, so it can be shared, but it can't be re-saved as a demo.
  await expect(page.getByTestId("share-button")).toBeEnabled();
  await expect(page.getByTestId("save-demo-button")).toBeDisabled();

  await select.selectOption("pendulum");
  await expect(page.getByTestId("sim-title")).toHaveText("Two Pendulums, Two Masses");
  await expect(panel).toHaveAttribute("data-state", "ready");
  expect(modelCalls).toEqual([]);
});

test("Save as demo posts the sim on screen", async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  // Intercept so the test doesn't write into the committed data/demos folder.
  await page.route("**/api/demos", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: { slug: "two-pendulums-two-masses" } });
  });
  await page.goto("/");
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.getByTestId("save-demo-button").click();
  await expect(page.getByTestId("demo-note")).toHaveText("Saved as a demo");
  expect(posted).toMatchObject({ prompt: "Does a heavier pendulum bob swing faster?", title: "Two Pendulums, Two Masses" });
  expect(String(posted!.code)).toContain("window.SIM");
  expect(posted!.params).toHaveLength(4);
});
