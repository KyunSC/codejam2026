import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractHtml, validateHtml } from "./sim-html";

const good = `<!DOCTYPE html><html><head></head><body><canvas id="c"></canvas><script>window.SIM={}</script></body></html>`;

describe("extractHtml", () => {
  it("strips fences and surrounding chatter", () => {
    expect(extractHtml("Here you go:\n```html\n" + good + "\n```\nEnjoy!")).toBe(good);
  });

  it("starts at <html when there is no doctype", () => {
    const noDoctype = good.replace("<!DOCTYPE html>", "");
    expect(extractHtml("text " + noDoctype + " more")).toBe(noDoctype);
  });

  it("keeps everything up to the last </html>", () => {
    const s = good + "<!-- </html> -->";
    expect(extractHtml(s)).toBe(s.slice(0, s.lastIndexOf("</html>") + 7));
  });

  it("leaves a clean document unchanged", () => {
    const pendulum = readFileSync("fixtures/sims/pendulum.html", "utf8");
    expect(extractHtml(pendulum)).toBe(pendulum.trim());
  });
});

describe("validateHtml", () => {
  it("accepts the good fixtures", () => {
    for (const name of ["pendulum", "pendulum-edited", "falling", "throws", "throws-broken", "bad-params"]) {
      expect(validateHtml(readFileSync(`fixtures/sims/${name}.html`, "utf8"))).toEqual({ ok: true });
    }
  });

  it("requires window.SIM and a canvas", () => {
    expect(validateHtml(readFileSync("fixtures/sims/no-sim.html", "utf8")).ok).toBe(false);
    expect(validateHtml(good.replace("<canvas", "<div"))).toMatchObject({ ok: false, reason: expect.stringMatching(/canvas/) });
  });

  it.each([
    ["script src", good.replace("<script>", '<script src="a.js"></script><script>')],
    ["link", good.replace("<head>", '<head><link rel="stylesheet" href="x.css">')],
    ["@import", good.replace("<head>", "<head><style>@import 'x.css';</style>")],
    ["iframe", good.replace("<body>", "<body><iframe></iframe>")],
    ["remote img src", good.replace("<body>", '<body><img src="https://x.test/a.png">')],
    ["remote url()", good.replace("<head>", "<head><style>body{background:url(https://x.test/a.png)}</style>")],
  ])("rejects %s", (_, html) => {
    expect(validateHtml(html).ok).toBe(false);
  });

  it("rejects the external-script fixture", () => {
    expect(validateHtml(readFileSync("fixtures/sims/external-script.html", "utf8")).ok).toBe(false);
  });

  it("caps size at 150 KB", () => {
    const big = good.replace("</body>", `<!--${"x".repeat(150 * 1024)}--></body>`);
    expect(validateHtml(big)).toMatchObject({ ok: false, reason: expect.stringMatching(/150 KB/) });
  });
});
