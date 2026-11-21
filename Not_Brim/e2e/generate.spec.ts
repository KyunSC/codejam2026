import { expect, test } from "./fixtures";

test("pendulum prompt reaches ready with 4 sliders, and sliders apply", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stand-in-badge")).toHaveText("Offline stand-in");
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();

  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "streaming");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });

  const frame = page.getByTestId("sim-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");

  const sliders = page.locator('input[type="range"]');
  await expect(sliders).toHaveCount(4);
  await expect(page.getByTestId("sim-title")).toHaveText("Two Pendulums, Two Masses");
  await expect(page.getByTestId("timing-badge")).toHaveText(/Interactive in \d+\.\ds/);

  // Saved on ready: the page learns the id, and GET /api/sims lists it.
  await expect(page.locator("[data-sim-id]")).not.toHaveAttribute("data-sim-id", "");
  const id = await page.locator("[data-sim-id]").getAttribute("data-sim-id");
  const { sims } = (await (await page.request.get("/api/sims")).json()) as { sims: Array<{ id: string; title: string }> };
  expect(sims.find((s) => s.id === id)?.title).toBe("Two Pendulums, Two Masses");

  await expect(panel).toHaveAttribute("data-applied", "0");
  await page.locator('input[data-param="massB"]').fill("8");
  await expect(panel).toHaveAttribute("data-applied", "1");
  await expect(page.getByTestId("value-massB")).toContainText("8.0");
});

for (const name of ["throws-broken", "no-sim", "bad-params", "external-script"]) {
  test(`/dev/fixture/${name} shows an error within 3 s`, async ({ page }) => {
    await page.goto(`/dev/fixture/${name}`);
    const loaded = Date.now();
    const panel = page.getByTestId("sim-panel");
    // no-sim errors at exactly 3 s after DOMContentLoaded; allow a little for the frame to load.
    await expect(panel).toHaveAttribute("data-state", "error", { timeout: 3_800 });
    const ms = Date.now() - loaded;
    test.info().annotations.push({ type: "error-after-ms", description: String(ms) });
    await expect(page.getByTestId("bridge-log")).toContainText("error:");
  });
}
