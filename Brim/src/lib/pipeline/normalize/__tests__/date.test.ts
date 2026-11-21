import { describe, expect, it } from "vitest";
import { parseDate } from "../date";

describe("parseDate", () => {
  it.each([
    ["2026-10-28", "2026-10-28"],
    ["2026/10/28", "2026-10-28"],
    ["2026.1.5", "2026-01-05"],
    ["28/10/2026", "2026-10-28"],
    ["10/28/2026", "2026-10-28"],
    ["13-04-2026", "2026-04-13"],
    ["04.13.2026", "2026-04-13"],
    ["05/05/2026", "2026-05-05"],
    ["October 28, 2026", "2026-10-28"],
    ["Oct 28, 2026", "2026-10-28"],
    ["Oct. 28 2026", "2026-10-28"],
    ["28 October 2026", "2026-10-28"],
    ["28-Oct-2026", "2026-10-28"],
    ["Sept 3, 2026", "2026-09-03"],
    ["Wednesday, October 28th, 2026", "2026-10-28"],
    ["the 1st of November 2026", "2026-11-01"],
    ["28 octobre 2026", "2026-10-28"],
    ["le 1er novembre 2026", "2026-11-01"],
    ["28 oct. 2026", "2026-10-28"],
    ["12 février 2026", "2026-02-12"],
    ["12 févr. 2026", "2026-02-12"],
    ["15 août 2026", "2026-08-15"],
    ["3 décembre 2026", "2026-12-03"],
    ["mercredi 28 octobre 2026", "2026-10-28"],
    ["  28   octobre   2026 ", "2026-10-28"],
  ])("%j → %s", (raw, expected) => {
    expect(parseDate(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["03/04/2026", ["2026-04-03", "2026-03-04"]],
    ["10/11/2026", ["2026-11-10", "2026-10-11"]],
    ["1/2/2026", ["2026-02-01", "2026-01-02"]],
  ])("%j is DATE_AMBIGUOUS between %j", (raw, candidates) => {
    const r = parseDate(raw, "invoiceDate");
    expect(r).toMatchObject({ ok: false, candidates, issue: { code: "DATE_AMBIGUOUS", field: "invoiceDate", raw } });
  });

  it.each([
    "31/02/2026",
    "2026-02-30",
    "28/10/26",
    "October 2026",
    "next Tuesday",
    "32 octobre 2026",
    "28 Brumaire 2026",
  ])("%j is DATE_UNPARSEABLE", (raw) => {
    expect(parseDate(raw)).toMatchObject({ ok: false, issue: { code: "DATE_UNPARSEABLE" } });
  });

  it("returns null for a missing date", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(" ")).toBeNull();
  });
});
