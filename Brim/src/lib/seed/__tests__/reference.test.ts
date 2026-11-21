import { describe, expect, it } from "vitest";
import { loadDataset } from "../../dataset";
import { dateOnly, timestamp } from "../convert";
import {
  bankStatementRows,
  cardTransactionRows,
  contractRows,
  policyRuleRows,
  userRows,
  vendorRows,
} from "../reference";

const ds = loadDataset();

describe("seed converters", () => {
  it("stores calendar dates at UTC midnight so @db.Date keeps the same day", () => {
    expect(dateOnly("2026-11-02").toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
  it("reads zone-less dataset timestamps as written", () => {
    expect(timestamp("2026-01-03T15:59:00").toISOString()).toBe("2026-01-03T15:59:00.000Z");
    expect(timestamp("2026-01-03T15:59:00-05:00").toISOString()).toBe("2026-01-03T20:59:00.000Z");
  });
});

describe("reference rows", () => {
  it("keeps dataset ids and money as exact strings", () => {
    const u = userRows(ds).find((r) => r.id === "U012")!;
    expect(u).toMatchObject({ status: "on_leave", delegateUserId: "U003", approvalLimitCad: "10000" });
    expect(u.statusSince).toEqual(dateOnly("2026-10-20"));
  });

  it("leaves bank details off the vendor row (they are versioned separately)", () => {
    const v = vendorRows(ds)[0] as Record<string, unknown>;
    expect(Object.keys(v).some((k) => k.startsWith("bank"))).toBe(false);
    expect(vendorRows(ds)).toHaveLength(56);
  });

  it("keeps blank contract caps as null, not zero", () => {
    const rows = contractRows(ds);
    expect(rows).toHaveLength(27);
    expect(rows.some((c) => c.hourlyRateCap === null)).toBe(true);
    expect(rows.every((c) => c.hourlyRateCap !== "0")).toBe(true);
  });

  it("marks imported bank and card rows as history", () => {
    expect(bankStatementRows(ds).every((b) => b.source === "history")).toBe(true);
    expect(cardTransactionRows(ds).every((c) => c.origin === "history")).toBe(true);
  });

  it("writes the 13 structured policy rules", () => {
    const rows = policyRuleRows(ds);
    expect(rows.map((r) => r.id)).toHaveLength(13);
    expect(rows.filter((r) => r.locked).map((r) => r.id)).toEqual(["P07", "P08", "P11"]);
  });
});
