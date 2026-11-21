import { describe, expect, it } from "vitest";
import { addDays, daysBetween, today } from "../today";

describe("today", () => {
  it("uses APP_TODAY when set", () => {
    expect(today({ APP_TODAY: "2026-11-02" })).toBe("2026-11-02");
  });
  it("rejects a malformed APP_TODAY", () => {
    expect(() => today({ APP_TODAY: "02/11/2026" })).toThrow(/YYYY-MM-DD/);
  });
  it("falls back to a real date when unset", () => {
    expect(today({})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("date helpers", () => {
  it("counts whole days across a month end", () => {
    expect(daysBetween("2026-10-28", "2026-11-02")).toBe(5);
    expect(daysBetween("2026-11-02", "2026-10-28")).toBe(-5);
  });
  it("adds days across a DST change without drifting", () => {
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
  });
});
