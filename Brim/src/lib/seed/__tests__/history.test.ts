import { describe, expect, it } from "vitest";
import { loadDataset } from "../../dataset";
import { historySeedRows } from "../history";

const ds = loadDataset();
const rows = historySeedRows(ds);

describe("history import rows", () => {
  it("has the Tables counts", () => {
    expect(rows.invoices).toHaveLength(426);
    expect(rows.lines).toHaveLength(809);
    expect(rows.steps).toHaveLength(474);
    expect(rows.payments).toHaveLength(415);
    expect(rows.invoices.every((i) => i.source === "history")).toBe(true);
  });

  it("keys the reformatted duplicate pairs so they meet", () => {
    const key = (id: string) => rows.invoices.find((i) => i.id === id)!;
    expect(key("AP-00073").digitsKey).toBe(key("AP-00077").digitsKey);
    expect(key("AP-00136").digitsKey).toBe(key("AP-00155").digitsKey);
    expect(key("AP-00023").numberKey).toBe(key("AP-00034").numberKey);
  });

  it("maps payment statuses to the app's vocabulary", () => {
    const count = (s: string) => rows.payments.filter((p) => p.status === s).length;
    expect({ settled: count("settled"), sent: count("sent"), scheduled: count("scheduled") }).toEqual({
      settled: 377,
      sent: 20,
      scheduled: 18,
    });
    expect(rows.payments.filter((p) => p.status === "sent").every((p) => p.method === "CHEQUE")).toBe(true);
  });

  it("writes a tax row per non-zero tax column, coded from the lines", () => {
    const of = (id: string) => rows.taxes.filter((t) => t.invoiceId === id).map((t) => [t.taxCode, t.amount]);
    expect(of("AP-00253")).toEqual([["HST13", "688.66"]]); // Alberta billed HST: kept as charged
    expect(of("AP-00325")).toEqual([]); // Ontario, no tax charged
    const qc = rows.invoices.find((i) => i.shipToProvince === "QC" && i.pstQstAmount !== "0")!;
    expect(of(qc.id as string).map(([c]) => c)).toEqual(["GST5", "QST9975"]);
  });

  it("gives each approval step its approver's limit, and the finance manager steps 50,000", () => {
    expect(rows.steps.filter((s) => s.role === "finance_manager")).toHaveLength(48);
    expect(rows.steps.filter((s) => s.role === "finance_manager").every((s) => s.limitCad === "50000")).toBe(true);
    expect(rows.steps.filter((s) => s.decision === "rejected")).toHaveLength(12);
  });
});
