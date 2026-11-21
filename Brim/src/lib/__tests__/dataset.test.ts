import { describe, expect, it } from "vitest";
import { loadDataset } from "../dataset";

// Smoke test only: every file parses with the expected columns.
// Exact row counts against BUILD_PLAN are checked by the rules engine's first task.
describe("dataset loaders", () => {
  const ds = loadDataset();

  it("loads every table", () => {
    for (const [name, rows] of Object.entries(ds)) {
      expect(rows.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps leading zeros in ids and bank numbers", () => {
    const withBank = ds.vendors.find((v) => v.bankInstitution?.startsWith("0"));
    expect(withBank?.bankInstitution).toMatch(/^0\d+$/);
    expect(ds.invoices.some((i) => /^0/.test(i.vendorInvoiceNumber))).toBe(true);
  });

  it("parses money as Decimal, flags as booleans, blanks as null", () => {
    const inv = ds.invoices[0];
    expect(inv.total.toFixed(2)).toMatch(/^\d+\.\d{2}$/);
    expect(typeof ds.vendors[0].requiresPo).toBe("boolean");
    expect(ds.users.some((u) => u.managerId === null)).toBe(true);
  });

  it("reads every email with its attachment list", () => {
    expect(ds.emails.every((e) => Array.isArray(e.attachments))).toBe(true);
  });
});
