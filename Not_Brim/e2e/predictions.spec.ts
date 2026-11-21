import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Teacher makes the pendulum and shares it; returns the student link. */
async function shareSim(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.getByTestId("share-button").click();
  return page.getByTestId("share-link").inputValue();
}

/** A student opens the link, predicts and presses Run. */
async function predict(context: BrowserContext, url: string, name: string, text: string): Promise<Page> {
  const s = await context.newPage();
  await s.goto(url);
  await s.getByTestId("name-input").fill(name);
  await s.getByTestId("prediction-input").fill(text);
  await s.getByTestId("run-button").click();
  await expect(s.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 10_000 });
  return s;
}

test("names reach the teacher; Enter in the name field after Run doesn't predict twice", async ({ page, context }) => {
  const url = await shareSim(page);
  const s = await predict(context, url, "Maya", "Same speed");
  await expect(s.getByTestId("name-input")).toHaveAttribute("readonly", "");
  await s.getByTestId("name-input").press("Enter");
  await s.waitForTimeout(500);
  await expect(s.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready");

  const list = page.getByTestId("class-predictions");
  await expect(list.getByTestId("prediction-item")).toHaveCount(1, { timeout: 10_000 });
  await expect(list).toContainText("Maya");
  await page.waitForTimeout(3500); // one more poll: still one
  await expect(list.getByTestId("prediction-item")).toHaveCount(1);
});

for (const size of [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1920x1080", width: 1920, height: 1080 },
]) {
  test(`sliders still fit after sharing and 5 predictions at ${size.name}`, async ({ page, context }) => {
    await page.setViewportSize(size);
    const url = await shareSim(page);
    for (let i = 0; i < 5; i++) await (await predict(context, url, `S${i}`, "A longer prediction that wraps onto a second line.")).close();
    await expect(page.getByTestId("predictions-chip")).toHaveText("5 predictions · 0 reflections", { timeout: 10_000 });
    for (const id of ["param-sliders", "share-button", "predictions-chip"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y + box!.height, `${id} fits in ${size.name}`).toBeLessThanOrEqual(size.height + 1);
    }
  });
}

test.describe("save failures", () => {
  test.use({ allowConsole: [/Failed to load resource/] });

  test("a failed reflection shows an error and can be sent again", async ({ page, context }) => {
    const url = await shareSim(page);
    const s = await predict(context, url, "Ana", "Heavier is faster");
    let fail = true;
    await s.route("**/api/sims/*/predictions/*", (route) =>
      fail ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
    );
    await s.getByTestId("observed-input").fill("They matched.");
    await s.getByTestId("observed-button").click();
    await expect(s.getByTestId("reflection-error")).toBeVisible();
    await expect(s.getByTestId("observed-button")).toBeEnabled();
    fail = false;
    await s.getByTestId("observed-button").click();
    await expect(s.getByTestId("reflection-saved")).toBeVisible();
    await expect(s.getByTestId("observed-input")).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("class-predictions")).toContainText("They matched.", { timeout: 10_000 });
  });

  test("a prediction that failed on Run is sent with the reflection", async ({ page, context }) => {
    const url = await shareSim(page);
    const s = await context.newPage();
    let fail = true;
    await s.route("**/api/sims/*/predictions", (route) =>
      fail && route.request().method() === "POST" ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
    );
    await s.goto(url);
    await s.getByTestId("prediction-input").fill("Same speed");
    await s.getByTestId("run-button").click();
    await expect(s.getByTestId("prediction-unsaved")).toBeVisible({ timeout: 10_000 });
    fail = false;
    await s.getByTestId("observed-input").fill("Same speed indeed.");
    await s.getByTestId("observed-button").click();
    await expect(s.getByTestId("reflection-saved")).toBeVisible();
    const list = page.getByTestId("class-predictions");
    await expect(list.getByTestId("prediction-item")).toHaveCount(1, { timeout: 10_000 });
    await expect(list).toContainText("Same speed indeed.");
  });
});

test("QR dialog fits a 1280x720 projector and closes on Escape and backdrop only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await shareSim(page);
  const qr = page.getByTestId("share-qr");
  const dialog = page.getByTestId("share-qr-dialog");
  await qr.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Scan for the homework" })).toBeVisible();
  const fits = await dialog.evaluate((d) => d.scrollHeight <= d.clientHeight + 1);
  expect(fits, "dialog content fits without scrolling").toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(qr).toBeFocused();

  await qr.click();
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12); // inside the white frame
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5); // backdrop
  await expect(dialog).toBeHidden();
});

test("after an edit the panel says it's for the earlier sim", async ({ page }) => {
  await shareSim(page);
  const panel = page.getByTestId("class-predictions");
  await expect(panel.getByTestId("predictions-for")).toContainText("Two Pendulums");
  await expect(panel.getByTestId("predictions-earlier")).toHaveCount(0);
  await page.getByTestId("edit-input").fill("make bob B twice as heavy");
  await page.getByTestId("edit-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(panel.getByTestId("predictions-earlier")).toBeVisible();
});
