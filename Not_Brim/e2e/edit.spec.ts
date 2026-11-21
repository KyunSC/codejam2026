import { expect, test } from "./fixtures";

test("pendulum → edit 'make bob B twice as heavy' → ready with a new bob B default", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("tool-sim").click();
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();
  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });

  const massB = page.locator('input[data-param="massB"]');
  const before = await massB.inputValue();
  const maxBefore = await massB.getAttribute("max");
  // A slider the teacher moved carries over through the edit.
  await page.locator('input[data-param="length"]').fill("2");
  await expect(panel).toHaveAttribute("data-applied", "1");

  await page.getByTestId("edit-input").fill("make bob B twice as heavy");
  await page.getByTestId("edit-button").click();
  await expect(panel).toHaveAttribute("data-state", "streaming");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });

  await expect(massB).not.toHaveValue(before);
  expect(Number(await massB.inputValue())).toBeGreaterThan(Number(before));
  expect(await massB.getAttribute("max")).not.toBe(maxBefore);
  await expect(page.locator('input[data-param="length"]')).toHaveValue("2");
  await expect(page.getByTestId("sim-question")).toContainText("ten times heavier");
});
