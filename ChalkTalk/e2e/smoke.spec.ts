import { expect, test } from "./fixtures";

test("the home page lists my whiteboards and the demo whiteboards, and starts a new one", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/My whiteboards · Live Sim/);
  await expect(page.getByTestId("no-boards")).toBeVisible();
  await expect(page.getByTestId("demo-boards").locator("li")).toHaveCount(2);
  await page.getByTestId("new-board").click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f]{12}$/);
  await expect(page.getByTestId("board")).toBeVisible();
  await page.getByTestId("board-title").fill("Forces homework");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5_000 });

  await page.getByTestId("boards-link").click();
  await expect(page.getByTestId("board-card")).toHaveText(["Forces homework"]);
});

test.describe(() => {
  test.use({ allowConsole: [/404 \(Not Found\)/] });
  test("an unknown board is a 404", async ({ page }) => {
    expect((await page.goto("/b/000000000000"))?.status()).toBe(404);
  });
});
