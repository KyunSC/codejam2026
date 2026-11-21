import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const SCREENS = path.join(process.cwd(), "progress", "screens");
mkdirSync(SCREENS, { recursive: true });

const SIZES = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x720", width: 1280, height: 720 },
];

/** Every visible element that directly holds text, with its computed font size. */
async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      if (["SCRIPT", "STYLE", "OPTION", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (!own && !field) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const size = parseFloat(cs.fontSize);
      if (size < 20) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${size}px`);
    }
    return bad;
  });
}

async function readyPendulum(page: Page) {
  await page.goto("/new");
  await page.getByTestId("tool-sim").click();
  await page.getByTestId("prompt-input").fill("Does a heavier pendulum bob swing faster?");
  await page.getByTestId("create-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}

async function addNote(page: Page, text: string) {
  await page.getByTestId("tool-note").click();
  await page.getByTestId("board").click({ position: { x: 240, y: 360 } });
  await page.keyboard.type(text);
}

for (const size of SIZES) {
  test(`board and student screens at ${size.name}`, async ({ page, context }) => {
    await page.setViewportSize(size);

    await page.goto("/new");
    await expect(page.getByTestId("stand-in-badge")).toBeVisible();
    expect(await smallText(page)).toEqual([]);
    await page.screenshot({ path: path.join(SCREENS, `board-empty-${size.name}.png`) });

    await addNote(page, "Does a heavier ball fall faster than a light one?");
    await page.getByTestId("ask-button").click();
    await expect(page.getByTestId("status-lines")).not.toHaveText("0 lines", { timeout: 10_000 });
    expect(await smallText(page)).toEqual([]);
    await page.screenshot({ path: path.join(SCREENS, `board-streaming-${size.name}.png`) });
    await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await page.waitForTimeout(600); // let the sim animate a little
    expect(await smallText(page)).toEqual([]);
    await page.screenshot({ path: path.join(SCREENS, `board-ready-${size.name}.png`) });

    // Everything important is on screen without panning.
    for (const id of ["tool-sim", "board-title", "sim-panel", "edit-input", "share-button", "param-sliders", "ask-button"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y + box!.height, `${id} fits in ${size.name}`).toBeLessThanOrEqual(size.height + 1);
      expect(box!.x + box!.width, `${id} fits in ${size.name}`).toBeLessThanOrEqual(size.width + 1);
    }

    await page.getByTestId("share-button").click();
    const url = await page.getByTestId("share-link").inputValue();
    const student = await context.newPage();
    await student.setViewportSize(size);
    await student.goto(url);
    await expect(student.getByTestId("homework-question")).toBeVisible();
    const title = (await page.getByTestId("sim-title").textContent())!;
    await expect(student.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    expect(await smallText(student)).toEqual([]);
    await student.screenshot({ path: path.join(SCREENS, `student-before-run-${size.name}.png`) });
    await student.getByTestId("prediction-input").fill("The heavy one lands first.");
    await student.getByTestId("run-button").click();
    await expect(student.getByTestId("sim-panel")).toHaveAttribute("data-state", "ready");
    await student.waitForTimeout(600);
    expect(await smallText(student)).toEqual([]);
    await student.screenshot({ path: path.join(SCREENS, `student-ready-${size.name}.png`) });
  });
}

test("teacher can use the prompt and simulation on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await readyPendulum(page);
  expect((await page.getByTestId("sim-frame").boundingBox())?.width).toBeGreaterThanOrEqual(300);
  await page.getByTestId("tool-sim").click();
  expect((await page.getByTestId("prompt-input").boundingBox())?.width).toBeGreaterThanOrEqual(300);
  await page.keyboard.press("Escape");
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test("failed state screenshot", async ({ page }) => {
  await page.setViewportSize(SIZES[1]);
  await page.goto("/new");
  await page.getByTestId("tool-sim").click();
  await page.getByTestId("prompt-input").fill("Why does a boat float? [[fixture:throws-twice]]");
  await page.getByTestId("create-button").click();
  await expect(page.getByTestId("sim-panel")).toHaveAttribute("data-state", "failed", { timeout: 20_000 });
  expect(await smallText(page)).toEqual([]);
  await page.screenshot({ path: path.join(SCREENS, "board-failed-1280x720.png") });
});

test("keyboard focus is visible on every control", async ({ page }) => {
  await readyPendulum(page);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // Skip the page itself, the sim, and Next's dev-tools portal (a custom element).
      if (!el || el === document.body || el.tagName === "IFRAME" || el.tagName.includes("-")) return null;
      const cs = getComputedStyle(el);
      return {
        key: el.getAttribute("data-testid") || el.getAttribute("data-param") || el.id || el.tagName,
        outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2,
      };
    });
    if (!info) continue;
    expect(info.outline, `focus ring on ${info.key}`).toBe(true);
    seen.add(info.key);
  }
  for (const key of ["boards-link", "board-title", "tool-pen", "tool-erase", "tool-sim", "massA", "edit-input", "share-button", "ask-input", "ask-button"]) {
    expect([...seen], `reached ${key} by Tab`).toContain(key);
  }
});
