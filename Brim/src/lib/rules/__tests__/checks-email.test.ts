import { describe, expect, it } from "vitest";
import type { ResolvedInvoice } from "../../types";
import { checkSenderDomainMismatch, checkSenderLookalikeDomain, emailDomain } from "../checks/email";
import { fresh, refs, summary } from "./fixtures";

type Row = [string, ResolvedInvoice, Array<{ code: string; effect: string }>];

describe("emailDomain", () => {
  it("lower-cases and strips display names", () => {
    expect(emailDomain("Billing <AR@Harlow.Example>")).toBe("harlow.example");
    expect(emailDomain("nonsense")).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});

describe("SENDER_DOMAIN_MISMATCH", () => {
  it.each<Row>([
    ["sender on the vendor's AP domain", fresh("V026", { senderAddress: "ar@harlow.example" }), []],
    ["another mailbox on the same domain", fresh("V026", { senderAddress: "jane@harlow.example" }), []],
    ["no sender (upload)", fresh("V026", { senderAddress: null }), []],
    ["no vendor resolved", fresh("V026", { vendorId: null, senderAddress: "ar@elsewhere.example" }), []],
    ["sender on another domain", fresh("V026", { senderAddress: "ar@gmail.example" }), [{ code: "SENDER_DOMAIN_MISMATCH", effect: "hold" }]],
  ])("%s", (_, i, want) => expect(summary(checkSenderDomainMismatch(i, refs))).toEqual(want));
});

describe("SENDER_LOOKALIKE_DOMAIN", () => {
  it.each<Row>([
    ["the unsealed V052 email: harlowandstern-llp.example contains harlow", fresh("V052", { senderAddress: "ar@harlowandstern-llp.example" }), [{ code: "SENDER_LOOKALIKE_DOMAIN", effect: "hold" }]],
    ["one letter off a vendor domain", fresh("V026", { senderAddress: "ar@harl0w.example" }), [{ code: "SENDER_LOOKALIKE_DOMAIN", effect: "hold" }]],
    ["exactly a vendor domain", fresh("V026", { senderAddress: "ar@harlow.example" }), []],
    ["an unrelated unknown sender", fresh("V026", { vendorId: null, senderAddress: "ar@blueheron.example" }), []],
    ["no sender", fresh("V026", { senderAddress: null }), []],
  ])("%s", (_, i, want) => expect(summary(checkSenderLookalikeDomain(i, refs))).toEqual(want));

  it("names the imitated vendor", () => {
    const [f] = checkSenderLookalikeDomain(fresh("V052", { senderAddress: "ar@harlowandstern-llp.example" }), refs);
    expect(f.message).toMatch(/harlow\.example.*V026/);
    expect(f.related?.vendorIds).toContain("V026");
  });

  it("no vendor domain imitates another in the vendor master except V052 / V026", () => {
    const hits = [...refs.vendors.values()].flatMap((v) =>
      checkSenderLookalikeDomain(fresh(v.vendorId, { senderAddress: v.apContactEmail }), refs).map(() => v.vendorId),
    );
    expect(hits).toEqual(["V052"]);
  });
});
