import { describe, expect, it } from "vitest";
import { clampToParam, formatValue, splitLabel, startingValues } from "./params";

const p = (id: string, value: number, min = 0, max = 10) => ({ id, label: id, min, max, step: 0.5, value });

describe("params helpers", () => {
  it("splits units off labels", () => {
    expect(splitLabel("Bob A mass (kg)")).toEqual({ name: "Bob A mass", unit: "kg" });
    expect(splitLabel("Air resistance (0 = vacuum)")).toEqual({ name: "Air resistance", unit: "0 = vacuum" });
    expect(splitLabel("Friction coefficient")).toEqual({ name: "Friction coefficient", unit: "" });
  });

  it("formats to the step's precision", () => {
    expect(formatValue(1.5, 0.5)).toBe("1.5");
    expect(formatValue(3, 1)).toBe("3");
    expect(formatValue(0.2, 0.01)).toBe("0.20");
  });

  it("clamps", () => {
    expect(clampToParam(p("a", 1), 99)).toBe(10);
    expect(clampToParam(p("a", 1), NaN)).toBe(1);
  });

  it("carries only values the teacher moved, and lets new defaults through", () => {
    const params = [p("massA", 1), p("massB", 10), p("angle", 20, 5, 60)];
    const carry = { values: { massA: 3, massB: 5, angle: 20 }, defaults: { massA: 1, massB: 5, angle: 20 } };
    expect(startingValues(params, { carry })).toEqual({ massA: 3, massB: 10, angle: 20 });
  });

  it("applies initial values within range", () => {
    expect(startingValues([p("a", 1)], { initial: { a: 50 } })).toEqual({ a: 10 });
    expect(startingValues([p("a", 1)], { initial: { b: 2 } })).toEqual({ a: 1 });
  });
});
