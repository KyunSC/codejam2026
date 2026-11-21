import { expect, test } from "./fixtures";

test("a demo whiteboard opens as a copy with its simulation running, and no model call", async ({ page }) => {
  const modelCalls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/(generate|repair|edit)$/.test(new URL(r.url()).pathname)) modelCalls.push(r.url());
  });
  await page.goto("/");
  await page.getByTestId("open-demo-falling").click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f]{12}$/);
  await expect(page.getByTestId("board-title")).toHaveValue("Two Balls Dropped Together");
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  await expect(page.getByTestId("sim-title")).toHaveText("Two Balls Dropped Together");
  await expect(page.locator('input[type="range"]')).toHaveCount(4);
  await expect(page.getByTestId("note")).toContainText("Does a heavier ball fall faster than a light one?");
  expect(modelCalls).toEqual([]);

  // The copy is now one of my boards; the demo itself is unchanged for the next person.
  await page.getByTestId("boards-link").click();
  await expect(page.getByTestId("board-card")).toHaveText(["Two Balls Dropped Together"]);
  await expect(page.getByTestId("demo-boards").locator("li")).toHaveCount(2);
});
