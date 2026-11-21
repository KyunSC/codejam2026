import { describe, expect, it } from "vitest";
import { BRIDGE_JS, CSP, asBridgeMessage, buildSrcdoc, defaultValues, validateParams } from "./bridge";

describe("BRIDGE_JS", () => {
  it("is one line, valid JS, and can't close its own script tag", () => {
    expect(BRIDGE_JS).not.toContain("\n");
    expect(BRIDGE_JS.toLowerCase()).not.toContain("</script");
    expect(() => new Function(BRIDGE_JS)).not.toThrow();
  });

  it("posts the contract's messages", () => {
    for (const s of ["__simBridge", "'ready'", "'applied'", "'error'", "setParams", "securitypolicyviolation", "unhandledrejection", "SIM was not defined within 3s", "e.source!==P", "setTimeout(poll,50)"]) {
      expect(BRIDGE_JS).toContain(s);
    }
  });
});

describe("buildSrcdoc", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

  it("injects CSP then bridge right after <head>, before generated scripts", () => {
    const out = buildSrcdoc('<!DOCTYPE html><html><head lang="x"><script>gen()</script></head><body></body></html>');
    expect(out).toBe(`<!DOCTYPE html><html><head lang="x">${meta}<script>${BRIDGE_JS}</script><script>gen()</script></head><body></body></html>`);
  });

  it("doesn't mistake <header> for <head>", () => {
    const out = buildSrcdoc("<html><body><header>x</header></body></html>");
    expect(out.indexOf(meta)).toBeLessThan(out.indexOf("<body>"));
    expect(out.startsWith(`<html><head>${meta}`)).toBe(true);
  });

  it("creates a head when there's no <html> either", () => {
    expect(buildSrcdoc("<!DOCTYPE html><canvas></canvas>")).toBe(`<!DOCTYPE html><head>${meta}<script>${BRIDGE_JS}</script></head><canvas></canvas>`);
    expect(buildSrcdoc("<canvas></canvas>").startsWith("<head>")).toBe(true);
  });

  it("keeps line numbers of the generated document", () => {
    const html = "<!DOCTYPE html>\n<html><head>\n<script>\nboom()\n</script></head></html>";
    expect(buildSrcdoc(html).split("\n").length).toBe(html.split("\n").length);
  });

  it("CSP blocks the network", () => {
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).not.toMatch(/https?:/);
  });
});

describe("asBridgeMessage", () => {
  it("ignores messages without the bridge flag", () => {
    expect(asBridgeMessage({ type: "ready" })).toBeNull();
    expect(asBridgeMessage("hi")).toBeNull();
    expect(asBridgeMessage({ __simBridge: true, type: "other" })).toBeNull();
  });

  it("normalises errors", () => {
    expect(asBridgeMessage({ __simBridge: true, type: "error", message: "", line: "3" })).toEqual({
      type: "error", message: "Unknown error", line: undefined, col: undefined,
    });
  });
});

describe("validateParams", () => {
  const p = (o: object = {}) => ({ id: "m", label: "Mass (kg)", min: 0, max: 10, step: 1, value: 5, ...o });

  it("accepts and clamps", () => {
    expect(validateParams([p({ value: 50 })])).toEqual({ ok: true, params: [p({ value: 10 })] });
    expect(validateParams([p({ value: -1 })])).toEqual({ ok: true, params: [p({ value: 0 })] });
  });

  it("falls back to the id when a label is missing", () => {
    const r = validateParams([p({ label: undefined })]);
    expect(r.ok && r.params[0].label).toBe("m");
  });

  it.each([
    ["not an array", { a: 1 }],
    ["empty", []],
    ["five params", [1, 2, 3, 4, 5].map((i) => p({ id: `p${i}` }))],
    ["duplicate ids", [p(), p()]],
    ["no id", [p({ id: "" })]],
    ["NaN", [p({ value: NaN })]],
    ["Infinity", [p({ max: Infinity })]],
    ["string number", [p({ min: "0" })]],
    ["min > max", [p({ min: 2000, max: 500, value: 1000 })]],
    ["min == max", [p({ min: 5, max: 5 })]],
    ["zero step", [p({ step: 0 })]],
    ["null entry", [null]],
  ])("rejects %s", (_, raw) => {
    expect(validateParams(raw).ok).toBe(false);
  });

  it("defaultValues maps ids to values", () => {
    expect(defaultValues([p(), p({ id: "n", value: 2 })])).toEqual({ m: 5, n: 2 });
  });
});

describe("text guard", () => {
  function setup(W = 600, H = 400) {
    const drawn: string[] = [];
    class Ctx {
      t = [1, 0, 0, 1, 0, 0];
      canvas = { width: W, height: H };
      font = "14px x";
      measureText(s: string) {
        return { width: s.length * 7, actualBoundingBoxLeft: 0, actualBoundingBoxRight: s.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
      }
      getTransform() { const [a, b, c, d, e, f] = this.t; return { a, b, c, d, e, f }; }
      scale(k: number) { this.t = [k, 0, 0, k, 0, 0]; }
      fillText(s: string, ..._: number[]) { drawn.push(s); }
      strokeText(s: string, ..._: number[]) { drawn.push("stroke:" + s); }
      clearRect(..._: number[]) {}
      fillRect(..._: number[]) {}
    }
    const win = { CanvasRenderingContext2D: Ctx, addEventListener() {}, parent: { postMessage() {} } };
    new Function("window", "document", BRIDGE_JS)(win, { addEventListener() {} });
    return { drawn, ctx: new Ctx() };
  }

  it("skips overlapping text and text past the edge", () => {
    const { drawn, ctx } = setup();
    ctx.fillText("Speed", 10, 20);
    ctx.fillText("Height", 12, 22);
    ctx.fillText("A long label", 560, 100);
    expect(drawn).toEqual(["Speed"]);
  });

  it("keeps a drop shadow and a stroke-then-fill outline at hiDPI scale", () => {
    const { drawn, ctx } = setup(1200, 800);
    ctx.scale(2);
    ctx.fillText("Speed", 101, 101);
    ctx.fillText("Speed", 100, 100);
    ctx.strokeText("Mass", 100, 200);
    ctx.fillText("Mass", 100, 200);
    expect(drawn).toEqual(["Speed", "Speed", "stroke:Mass", "Mass"]);
  });

  it("forgets text that was cleared or resized away within the same task", () => {
    const { drawn, ctx } = setup();
    ctx.fillText("t = 0.00 s", 10, 20);
    ctx.clearRect(0, 0, 600, 400);
    ctx.fillText("t = 1.00 s", 10, 20);
    ctx.canvas.width = 500;
    ctx.fillText("t = 2.00 s", 10, 20);
    expect(drawn).toEqual(["t = 0.00 s", "t = 1.00 s", "t = 2.00 s"]);
  });

  it("never throws into the sim when measuring fails", () => {
    const { drawn, ctx } = setup();
    ctx.measureText = () => { throw new Error("boom"); };
    expect(() => ctx.fillText("Speed", 10, 20)).not.toThrow();
    expect(() => ctx.clearRect(0, 0, 10, 10)).not.toThrow();
    expect(drawn).toEqual(["Speed"]);
  });
});
