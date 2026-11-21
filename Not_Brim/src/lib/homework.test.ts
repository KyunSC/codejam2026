import { describe, expect, it } from "vitest";
import { validateHomework } from "./homework";
import type { SimParam } from "./types";

const params: SimParam[] = [
  { id: "mass", label: "Mass (kg)", min: 0.5, max: 10, step: 0.5, value: 1 },
  { id: "angle", label: "Angle (°)", min: 5, max: 60, step: 5, value: 20 },
];

describe("validateHomework", () => {
  it("clamps and snaps defaults into range, fills missing ones and drops unknown ids", () => {
    const r = validateHomework({ question: "  What now?  ", defaults: { mass: 99, angle: 22.4, bogus: 3 } }, params);
    expect(r).toEqual({ ok: true, homework: { question: "What now?", defaults: { mass: 10, angle: 20 } } });
    const missing = validateHomework({ question: "Q", defaults: { mass: -4 } }, params);
    expect(missing.ok && missing.homework.defaults).toEqual({ mass: 0.5, angle: 20 });
  });

  it("snaps onto the step grid without float noise", () => {
    const p: SimParam = { id: "l", label: "Length (m)", min: 0.5, max: 3, step: 0.1, value: 1.5 };
    const r = validateHomework({ question: "Q", defaults: { l: 1.73 } }, [p]);
    expect(r.ok && r.homework.defaults.l).toBe(1.7);
  });

  it("ignores non-numeric defaults and rejects a blank question", () => {
    const r = validateHomework({ question: "Q", defaults: { mass: "7", angle: Number.NaN } }, params);
    expect(r.ok && r.homework.defaults).toEqual({ mass: 1, angle: 20 });
    expect(validateHomework({ question: " ", defaults: {} }, params).ok).toBe(false);
    expect(validateHomework(null, params).ok).toBe(false);
  });
});
