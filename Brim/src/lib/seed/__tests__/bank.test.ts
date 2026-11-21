import { describe, expect, it } from "vitest";
import { type BankChangeRow, loadDataset, type VendorRow } from "../../dataset";
import { bankSeedRows } from "../bank";
import { dateOnly } from "../convert";

const ds = loadDataset();

describe("bank seed from the dataset", () => {
  const { accounts, requests, warnings } = bankSeedRows(ds);

  it("imports the 9 changes, with only BC-009 pending", () => {
    expect(requests).toHaveLength(9);
    expect(requests.filter((r) => r.status === "pending").map((r) => r.id)).toEqual(["BC-009"]);
    expect(requests.find((r) => r.id === "BC-009")).toMatchObject({
      vendorId: "V004",
      channel: "email_request",
      verifiedByCallback: false,
      newLast4: "9679",
      newAccount: "953389679",
    });
  });

  it("gives every vendor with bank details exactly one live account", () => {
    const live = accounts.filter((a) => a.validTo === null);
    expect(live).toHaveLength(ds.vendors.filter((v) => v.bankAccount !== null).length);
    expect(new Set(live.map((a) => a.vendorId)).size).toBe(live.length);
    expect(ds.vendors.length - live.length).toBe(7); // card-paid vendors with no bank details
  });

  it("keeps the replaced account as a last-4-only version ending on the change date", () => {
    const v004 = accounts.filter((a) => a.vendorId === "V004");
    expect(v004).toHaveLength(2);
    expect(v004[0]).toMatchObject({ last4: "7504", validTo: dateOnly("2026-10-27") });
    expect(v004[0].account ?? null).toBeNull();
    expect(v004[1]).toMatchObject({ last4: "9679", account: "953389679", validFrom: dateOnly("2026-10-27"), validTo: null });
    expect(v004[1].changeRequestId).toBe("BC-009");
  });

  it("finds the CSVs consistent with each other", () => {
    expect(warnings).toEqual([]);
  });
});

describe("bank seed edge cases", () => {
  const base = ds.vendors.find((v) => v.vendorId === "V004")!;
  const vendor = (over: Partial<VendorRow>): VendorRow => ({ ...base, ...over });
  const change = (over: Partial<BankChangeRow>): BankChangeRow => ({ ...ds.bankChanges[8], ...over });

  it("chains two changes for one vendor in date order", () => {
    const v = vendor({ vendorId: "VX", bankAccount: "11112222", onboardedAt: "2025-01-01" });
    const later = change({ changeId: "C2", vendorId: "VX", changedAt: "2026-06-01", oldAccountLast4: "3333", newAccountLast4: "2222" });
    const earlier = change({ changeId: "C1", vendorId: "VX", changedAt: "2026-02-01", oldAccountLast4: "4444", newAccountLast4: "3333" });
    const { accounts, requests, warnings } = bankSeedRows({ vendors: [v], bankChanges: [later, earlier] });
    expect(accounts.map((a) => a.last4)).toEqual(["4444", "3333", "2222"]);
    expect(requests.map((r) => [r.id, r.newAccount ?? null])).toEqual([
      ["C1", null],
      ["C2", "11112222"],
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns when the last change does not end in the account on file", () => {
    const v = vendor({ vendorId: "VX", bankAccount: "11119999" });
    const c = change({ vendorId: "VX", newAccountLast4: "2222" });
    expect(bankSeedRows({ vendors: [v], bankChanges: [c] }).warnings[0]).toMatch(/ends 2222.*…9999/);
  });
});
