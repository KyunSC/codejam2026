import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { datasetDir, loadDataset } from "../src/lib/dataset";
import { readSealedList, verifyCounts } from "./verify-counts";

describe("BUILD_PLAN Tables counts", () => {
  const dir = datasetDir();
  const incoming = readdirSync(path.join(dir, "incoming_invoices")).filter((f) => !f.startsWith("."));
  const results = verifyCounts(loadDataset(), incoming, readSealedList(dir));

  it("checks a meaningful number of counts", () => {
    expect(results.length).toBeGreaterThan(80);
  });

  it("every count matches the dataset", () => {
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("reports a mismatch when the data differs", () => {
    const ds = loadDataset();
    const fewer = verifyCounts({ ...ds, users: ds.users.slice(1) }, incoming, readSealedList(dir));
    expect(fewer.find((r) => r.table === "users" && r.what === "rows")).toMatchObject({ ok: false, expected: 40, actual: 39 });
  });
});
