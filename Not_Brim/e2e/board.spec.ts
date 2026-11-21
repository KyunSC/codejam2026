import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function addNote(page: Page, text: string, at = { x: 300, y: 400 }) {
  await page.getByTestId("tool-note").click();
  await page.getByTestId("board").click({ position: at });
  await page.keyboard.type(text);
}

test("the student writes a note, Claude reads it and answers with a note and a simulation, and it all survives a reload", async ({ page }) => {
  await page.goto("/");
  await addNote(page, "Does a heavier pendulum swing faster?");
  await expect(page.getByTestId("note")).toHaveAttribute("data-author", "student");

  let sent: { items: Array<{ kind: string; text?: string }>; image: string | null; view: unknown } | null = null;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/board-turn")) sent = r.postDataJSON();
  });
  await page.getByTestId("ask-button").click();
  await expect(page.getByTestId("ask-status")).toHaveAttribute("data-state", "busy");
  await expect(page.getByTestId("ask-status")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  await expect(page.getByTestId("ask-status")).toHaveText("Claude made 2 changes on the board.");

  // Claude was sent the board as items and as a picture.
  expect(sent!.items).toEqual([expect.objectContaining({ kind: "note", text: "Does a heavier pendulum swing faster?" })]);
  expect(sent!.image).toMatch(/^iVBORw0KGgo/);
  expect(sent!.view).toEqual(expect.objectContaining({ w: expect.any(Number) }));

  const reply = page.locator('[data-testid="note"][data-author="claude"]');
  await expect(reply).toContainText('I read your note: "Does a heavier pendulum swing faster?"');
  const box = page.getByTestId("sim-box");
  await expect(box).toHaveAttribute("data-author", "claude");
  await expect(box.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(box.locator('input[type="range"]')).toHaveCount(4);

  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5_000 });
  const modelCalls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/(generate|repair|edit)$/.test(new URL(r.url()).pathname)) modelCalls.push(r.url());
  });
  await page.reload();
  await expect(page.getByTestId("note")).toHaveCount(2);
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 10_000 });
  expect(modelCalls).toEqual([]);
});

test("Claude changes its own simulation when asked", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("ask-input").fill("Does a heavier pendulum swing faster?");
  await page.getByTestId("ask-button").click();
  const panel = page.getByTestId("sim-panel");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const massB = page.locator('input[data-param="massB"]');
  const before = Number(await massB.inputValue());

  await page.getByTestId("ask-input").fill("change: make bob B twice as heavy");
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-state", "streaming");
  await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  expect(Number(await massB.inputValue())).toBeGreaterThan(before);
  await expect(page.locator('[data-testid="note"][data-author="claude"]').last()).toContainText("I'm changing the simulation");
});

test("the pen writes handwriting, grouped into one item, which can be selected and deleted", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tool-pen").click();
  const board = page.getByTestId("board");
  const b = (await board.boundingBox())!;
  for (const [x0, y0, x1, y1] of [[300, 300, 340, 380], [350, 300, 310, 380]]) {
    await page.mouse.move(b.x + x0, b.y + y0);
    await page.mouse.down();
    await page.mouse.move(b.x + (x0 + x1) / 2, b.y + (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(b.x + x1, b.y + y1, { steps: 4 });
    await page.mouse.up();
  }
  const ink = page.getByTestId("ink");
  await expect(ink).toHaveCount(1);
  await expect(ink.locator("path")).toHaveCount(2);

  await page.getByTestId("ask-button").click();
  await expect(page.locator('[data-testid="note"][data-author="claude"]')).toContainText("handwriting");

  await page.getByTestId("tool-select").click();
  await ink.click();
  await page.keyboard.press("Delete");
  await expect(ink).toHaveCount(0);
});

test("dragging a note moves it", async ({ page }) => {
  await page.goto("/");
  await addNote(page, "Move me");
  const note = page.getByTestId("note");
  const before = (await note.boundingBox())!;
  const handle = note.getByTestId("item-handle");
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + 40, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 240, h.y + h.height / 2 + 100, { steps: 6 });
  await page.mouse.up();
  const after = (await note.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(200);
  expect(Math.round(after.y - before.y)).toBe(100);
});
