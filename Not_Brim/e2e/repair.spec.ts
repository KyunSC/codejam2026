import { expect, test } from "@playwright/test";

async function create(page: import("@playwright/test").Page, prompt: string) {
  await page.goto("/");
  await page.getByTestId("prompt-input").fill(prompt);
  await page.getByTestId("create-button").click();
}

test("throws-broken is repaired once and reaches ready", async ({ page }) => {
  await create(page, "Block sliding down a ramp [[fixture:throws-broken]]");
  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "repairing", { timeout: 20_000 });
  await expect(page.getByTestId("status-label")).toHaveText("Fixing a glitch…");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator('input[type="range"]')).toHaveCount(3);
  await expect(page.getByTestId("sim-frame")).toHaveCount(1);
});

test("throws-twice fails after one repair, with a friendly message and no iframe", async ({ page }) => {
  await create(page, "Why does a boat float? [[fixture:throws-twice]]");
  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "repairing", { timeout: 20_000 });
  await expect(panel).toHaveAttribute("data-state", "failed", { timeout: 20_000 });
  await expect(page.getByTestId("failed-message")).toContainText("didn't work");
  await expect(page.getByTestId("sim-frame")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
