import { expect, test } from "./fixtures";

test("pick one of six pets; the choice shows in the header and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/new");
  await expect(page).toHaveURL(/\/b\/[^/]+$/);
  await expect(page.getByTestId("board")).toBeVisible();
  // The pet button sits in the toolbox bar, level with its first button.
  const barTop = (await page.getByTestId("boards-link").boundingBox())!.y;
  expect((await page.getByTestId("pet-button").boundingBox())!.y).toBeLessThan(barTop + 20);
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

test("the newest choice still applies when storage is readable but full", async ({ page }) => {
  await page.goto("/new");
  const button = page.getByTestId("pet-button");
  await button.click();
  await page.getByTestId("pet-option-bob").click();
  await expect(button).toHaveAccessibleName("Your pet: Bob. Change pet");
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "livesim.pet") throw new DOMException("Storage full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });

  await button.click();
  await page.getByTestId("pet-option-hypo").click();
  await expect(button).toHaveAccessibleName("Your pet: Hypo. Change pet");
  expect(await page.evaluate(() => localStorage.getItem("livesim.pet"))).toBe("bob");
});

test("interior padding keeps the dialog open and a backdrop click closes it", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("pet-button").click();
  const dialog = page.getByRole("dialog", { name: "Pick your lab pet" });
  await dialog.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
});
