import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { type AuditFields, auditHash, canonicalJson, chainRows, GENESIS_HASH, verifyChain } from "../chain";

function event(i: number, over: Partial<AuditFields> = {}): AuditFields {
  return {
    at: new Date(`2026-10-0${i}T12:00:00Z`),
    actorId: "U007",
    actorRole: "approver",
    onBehalfOfId: null,
    action: "invoice.approve",
    entityType: "invoice",
    entityId: `AP-0000${i}`,
    invoiceId: `AP-0000${i}`,
    paymentId: null,
    vendorId: "V001",
    before: { status: "pending_approval" },
    after: { status: "approved", total: new Decimal("4743.80") },
    reason: null,
    source: "history",
    ...over,
  };
}

describe("canonical JSON", () => {
  it("sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } })).toBe('{"a":{"c":[{"e":2,"f":1}],"d":2},"b":1}');
  });
  it("writes dates, bigints and Decimals as strings, drops undefined", () => {
    expect(canonicalJson({ at: new Date("2026-11-02T00:00:00Z"), n: 5n, d: new Decimal("1.50"), u: undefined })).toBe(
      '{"at":"2026-11-02T00:00:00.000Z","d":"1.5","n":"5"}',
    );
  });
  it("refuses values that would hash ambiguously", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: new Date("nope") })).toThrow(/invalid Date/);
  });
});

describe("audit hash chain", () => {
  const rows = chainRows([event(1), event(2), event(3)]).map((r, i) => ({ ...r, seq: BigInt(i + 1) }));

  it("links each row to the one before, starting from genesis", () => {
    expect(rows[0].prevHash).toBe(GENESIS_HASH);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on key order or seq", () => {
    const shuffled = Object.fromEntries(Object.entries(event(1)).reverse()) as unknown as AuditFields;
    expect(auditHash(GENESIS_HASH, shuffled)).toBe(rows[0].hash);
    expect(auditHash(GENESIS_HASH, { ...event(1), seq: 99n } as AuditFields)).toBe(rows[0].hash);
  });

  it("verifies an intact chain", () => {
    expect(verifyChain(rows)).toEqual({ ok: true, count: 3, lastHash: rows[2].hash });
    expect(verifyChain([])).toEqual({ ok: true, count: 0, lastHash: GENESIS_HASH });
  });

  it("names the first changed row", () => {
    const tampered = rows.map((r) => ({ ...r }));
    tampered[1].after = { status: "approved", total: "9999.00" };
    const res = verifyChain(tampered);
    expect(res).toMatchObject({ ok: false, index: 1, seq: "2" });
    if (!res.ok) expect(res.reason).toMatch(/changed after it was written/);
  });

  it("names the row after a deleted one", () => {
    const res = verifyChain([rows[0], rows[2]]);
    expect(res).toMatchObject({ ok: false, index: 1, seq: "3" });
    if (!res.ok) expect(res.reason).toMatch(/removed, inserted or reordered/);
  });

  it("continues a chain from an existing last hash", () => {
    const more = chainRows([event(4)], rows[2].hash);
    expect(verifyChain([...rows, ...more]).ok).toBe(true);
    expect(verifyChain(more, rows[2].hash).ok).toBe(true);
  });
});
