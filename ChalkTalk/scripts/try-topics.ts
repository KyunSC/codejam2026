// Times three physics confusions end to end through the real UI and writes the
// results as a table into progress/report.md. Run: npm run try-topics
// Without a key this proves the plumbing with the stand-in; with a key it measures Claude.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const TOPICS = [
  "Why does a ball thrown at 45° go farther than one at 60°?",
  "Does a stiffer spring make the mass bounce faster or slower?",
  "When a light ball hits a heavy ball, why does the light one bounce back?",
];

interface RunLog {
  outcome: "ready" | "failed";
  firstDeltaMs: number | null;
  streamDoneMs: number | null;
  readyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  repaired: boolean;
  detail: string | null;
}

const REPORT = path.join(process.cwd(), "progress", "report.md");
const START = "<!-- try-topics:start -->";
const END = "<!-- try-topics:end -->";

const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

test("try topics", async ({ page, request }) => {
  const { standIn } = (await (await request.get("/api/status")).json()) as { standIn: boolean };
  const rows: string[] = [];

  for (const topic of TOPICS) {
    let log: RunLog | null = null;
    const onConsole = (msg: { text(): string }) => {
      const text = msg.text();
      if (text.startsWith("[sim] run ")) log = JSON.parse(text.slice("[sim] run ".length)) as RunLog;
    };
    page.on("console", onConsole);
    await page.goto("/");
    await page.getByTestId("prompt-input").fill(topic);
    await page.getByTestId("create-button").click();
    const panel = page.getByTestId("sim-panel");
    await expect(panel).toHaveAttribute("data-state", /^(ready|failed)$/, { timeout: 10 * 60_000 });
    await expect.poll(() => log !== null, { timeout: 5_000 }).toBe(true);
    page.off("console", onConsole);
    const r = log as unknown as RunLog;
    const title = r.outcome === "ready" ? await page.getByTestId("sim-title").innerText() : "–";
    rows.push(
      `| ${topic} | ${r.outcome} | ${title} | ${sec(r.firstDeltaMs)} | ${sec(r.streamDoneMs)} | ${sec(r.readyMs)} | ${r.inputTokens ?? "–"} / ${r.outputTokens ?? "–"} | ${r.repaired ? "yes" : "no"} |`,
    );
  }

  const when = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const block = [
    START,
    `### try-topics (${standIn ? "stand-in: plumbing only, not real timings" : "real model"}, ${when})`,
    "",
    "| Confusion | Outcome | Title | First code | Stream done | Interactive | Tokens in / out | Repaired |",
    "| -- | -- | -- | -- | -- | -- | -- | -- |",
    ...rows,
    END,
  ].join("\n");

  const current = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "# Live Sim build report\n";
  const next = current.includes(START)
    ? current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length)
    : current.trimEnd() + "\n\n" + block + "\n";
  writeFileSync(REPORT, next);
  console.log(block);
});
