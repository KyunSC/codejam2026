import { describe, expect, it } from "vitest";
import { verifyChain } from "../../audit/chain";
import { loadDataset } from "../../dataset";
import { historyAuditEvents } from "../audit-history";

const events = historyAuditEvents(loadDataset());
const count = (action: string) => events.filter((e) => e.action === action).length;

describe("history audit events", () => {
  it("has one event per approval and per payment", () => {
    expect(events).toHaveLength(474 + 415);
    expect(count("invoice.approve")).toBe(462);
    expect(count("invoice.reject")).toBe(12);
    expect(count("payment.release")).toBe(397);
    expect(count("payment.schedule")).toBe(18);
    expect(events.every((e) => e.source === "history")).toBe(true);
  });

  it("is in time order and forms a chain that verifies", () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at.getTime()).toBeGreaterThanOrEqual(events[i - 1].at.getTime());
    }
    expect(verifyChain(events).ok).toBe(true);
  });

  it("is reproducible", () => {
    expect(historyAuditEvents(loadDataset()).at(-1)!.hash).toBe(events.at(-1)!.hash);
  });

  it("records the releaser with their role, and the preparer alongside", () => {
    const rel = events.find((e) => e.action === "payment.release" && e.paymentId === "PAY-00002")!;
    expect(rel).toMatchObject({ actorId: "U002", actorRole: "controller_admin", invoiceId: "AP-00002", vendorId: "V036" });
    expect(rel.after).toMatchObject({ preparedById: "U005", releasedById: "U002", reference: "BRIM-EFT-18192411" });
  });

  it("keeps a rejection's comment as the reason", () => {
    const rejected = events.filter((e) => e.action === "invoice.reject");
    expect(rejected.every((e) => typeof e.reason === "string" && e.reason.length > 0)).toBe(true);
  });

  it("dates unreleased payments no earlier than the invoice's last approval", () => {
    for (const e of events.filter((x) => x.action === "payment.schedule")) {
      const approvals = events.filter((x) => x.invoiceId === e.invoiceId && x.entityType === "invoice");
      expect(approvals.length).toBeGreaterThan(0);
      expect(e.at.getTime()).toBe(Math.max(...approvals.map((a) => a.at.getTime())));
    }
  });
});
