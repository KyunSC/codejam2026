import { expect, test } from "./fixtures";

test("home page opens a new whiteboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/b\/[0-9a-f]{12}$/);
  await expect(page).toHaveTitle(/Whiteboard · Live Sim/);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("ask-button")).toBeEnabled();
});

test.describe(() => {
  test.use({ allowConsole: [/404 \(Not Found\)/] });
  test("an unknown board is a 404", async ({ page }) => {
    expect((await page.goto("/b/000000000000"))?.status()).toBe(404);
  });
});
