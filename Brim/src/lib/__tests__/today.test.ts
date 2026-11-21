import { describe, expect, it } from "vitest";
import { addDays, daysBetween, toIsoDate, today } from "../today";

describe("toIsoDate", () => {
  it("accepts real days and trims", () => {
    expect(toIsoDate(" 2026-11-02 ")).toBe("2026-11-02");
  });
  it("returns null for anything else", () => {
    for (const v of ["2026-02-30", "02/11/2026", "2026-11-2", "", null, undefined]) {
      expect(toIsoDate(v), String(v)).toBeNull();
    }
  });
});

describe("today", () => {
  it("uses APP_TODAY when set", () => {
    expect(today({ APP_TODAY: "2026-11-02" })).toBe("2026-11-02");
  });
  it("rejects a malformed APP_TODAY", () => {
    expect(() => today({ APP_TODAY: "02/11/2026" })).toThrow(/YYYY-MM-DD/);
  });
  it("rejects a date that does not exist", () => {
    expect(() => today({ APP_TODAY: "2026-02-30" })).toThrow(/YYYY-MM-DD/);
    expect(() => today({ APP_TODAY: "2026-04-31" })).toThrow(/YYYY-MM-DD/);
    expect(() => today({ APP_TODAY: "2026-02-29" })).toThrow(/YYYY-MM-DD/);
    expect(today({ APP_TODAY: "2028-02-29" })).toBe("2028-02-29");
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
