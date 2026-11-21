import { describe, expect, it } from "vitest";
import { actionGroupFor } from "../audit";
import { groupIntoActions } from "../audit-groups";

const row = (seq: number, g: string | null = null) => ({ seq: BigInt(seq), actionGroupId: g, name: `r${seq}` });
const names = (e: { head: { name: string }; parts: { name: string }[] }) => [e.head.name, ...e.parts.map((p) => p.name)];

describe("actionGroupFor", () => {
  it("gives one id per transaction client and none to a plain client", () => {
    const txA = {};
    const txB = {};
    const a = actionGroupFor(txA);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(actionGroupFor(txA)).toBe(a);
    expect(actionGroupFor(txB)).not.toBe(a);
    expect(actionGroupFor({ $connect: () => {}, $transaction: () => {} })).toBeNull();
    expect(actionGroupFor({ $transaction: () => {} })).not.toBeNull();
  });
});

describe("groupIntoActions", () => {
  it("leaves ungrouped rows as single entries, newest first", () => {
    const out = groupIntoActions([row(3), row(2), row(1)], []);
    expect(out.map(names)).toEqual([["r3"], ["r2"], ["r1"]]);
  });

  it("shows a group once, headed by its first row, with the rest in the order written", () => {
    const page = [row(10, "g"), row(9, "g"), row(8), row(7, "g")];
    const out = groupIntoActions(page, page.filter((r) => r.actionGroupId));
    // Placed by its newest row (10), so it still sits above r8.
    expect(out.map(names)).toEqual([["r7", "r9", "r10"], ["r8"]]);
  });

  it("puts an approval's 'added the user' on top and the approval underneath", () => {
    const added = { seq: 1714n, actionGroupId: "g", name: "user.created" };
    const approved = { seq: 1715n, actionGroupId: "g", name: "access_request.approved" };
    const out = groupIntoActions([approved, added], [approved, added]);
    expect(out.map(names)).toEqual([["user.created", "access_request.approved"]]);
  });

  it("pulls in group rows that the page or its filters left out", () => {
    const out = groupIntoActions([row(5, "g")], [row(6, "g"), row(5, "g"), row(4, "g")]);
    expect(out.map(names)).toEqual([["r4", "r5", "r6"]]);
  });

  it("drops a group already shown on a newer page", () => {
    const out = groupIntoActions([row(4, "g"), row(3)], [row(6, "g"), row(4, "g")], 5n);
    expect(out.map(names)).toEqual([["r3"]]);
  });

  it("orders entries by where their action finished", () => {
    const out = groupIntoActions([row(5, "a"), row(4)], [row(9, "a"), row(3, "a"), row(5, "a")]);
    // Group a spans 3..9: headed by r3, placed at 9, so above r4.
    expect(out.map((e) => e.head.name)).toEqual(["r3", "r4"]);
  });
});
