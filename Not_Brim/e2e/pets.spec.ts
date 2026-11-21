import { expect, test } from "./fixtures";

test("pick one of six pets; the choice shows in the header and survives a reload", async ({ page }) => {
  await page.goto("/");
  // The button fits on the teacher header's single row at 1280px.
  await page.setViewportSize({ width: 1280, height: 720 });
  const logoTop = (await page.getByLabel("Live Sim").boundingBox())!.y;
  expect((await page.getByTestId("pet-button").boundingBox())!.y).toBeLessThan(logoTop + 20);
  const button = page.getByTestId("pet-button");
  await expect(page.getByTestId("pet-name")).toHaveText("Pick a pet");

  await button.click();
  const dialog = page.getByTestId("pet-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-testid^="pet-option-"]')).toHaveCount(6);

  await page.getByTestId("pet-option-hypo").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("pet-name")).toHaveText("Your pet: Hypo. Change pet");

  await page.reload();
  await expect(page.getByTestId("pet-name")).toHaveText("Your pet: Hypo. Change pet");

  await page.getByTestId("pet-button").click();
  await expect(page.getByTestId("pet-option-hypo")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
