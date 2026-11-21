import { expect, test } from "./fixtures";

test("create → share → open link → predict → Run → ready with the homework question", async ({ page, context }) => {
  await page.goto("/");
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });

  const share = page.getByTestId("share-button");
  await expect(share).toBeEnabled();
  await share.click();
  const linkBox = page.getByTestId("share-link");
  await expect(linkBox).toHaveValue(/\/s\/[0-9a-f]{12}$/);
  const url = await linkBox.inputValue();

  const student = await context.newPage();
  await student.goto(url);
  const question = student.getByTestId("homework-question");
  await expect(question).toContainText("Homework for");
  await expect(question).toContainText("predict");
  const panel = student.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "idle");
  await expect(student.getByTestId("sim-frame")).toHaveCount(0);

  const run = student.getByTestId("run-button");
  await expect(run).toBeDisabled();
  await student.getByTestId("prediction-input").fill("   ");
  await expect(run).toBeDisabled();
  await student.getByTestId("prediction-input").fill("Both swing at the same rate, mass doesn't matter.");
  await expect(run).toBeEnabled();
  await run.click();

  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 10_000 });
  await expect(student.getByTestId("sim-frame")).toHaveAttribute("sandbox", "allow-scripts");
  await expect(student.locator('input[type="range"]')).toHaveCount(4);
  // Homework defaults moved one step from the class defaults.
  await expect(student.locator('input[data-param="massA"]')).not.toHaveValue("1");
  await expect(student.getByTestId("prediction-input")).toHaveAttribute("readonly", "");

  // Sharing again reuses the same homework.
  const again = (await (await page.request.post(url.replace(/\/s\/(\w+)$/, "/api/sims/$1/share"))).json()) as {
    homework: { question: string };
  };
  await expect(question).toHaveText(again.homework.question);
});

test.describe(() => {
  test.use({ allowConsole: [/404 \(Not Found\)/] });
  test("an unknown student link is a 404", async ({ page }) => {
  const res = await page.goto("/s/000000000000");
  expect(res?.status()).toBe(404);
});
});
