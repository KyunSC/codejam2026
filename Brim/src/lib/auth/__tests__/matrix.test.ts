import { describe, expect, it } from "vitest";
import type { Role } from "../../types";
import {
  type Action,
  type Actor,
  authorize,
  canDecideStep,
  canRelease,
  checkDidNotApprove,
  checkFourEyes,
  checkIsAssignee,
  checkNotReadOnly,
  checkNotRequester,
  checkReleaseLimit,
  MATRIX,
  MUTATING_ACTIONS,
  ROLES,
  roleCan,
  type StepRecord,
  VENDOR_VIEW,
} from "../matrix";

const actor = (role: Role, userId = "UX", departmentId = "D01"): Actor => ({ userId, role, departmentId });

// BUILD_PLAN "Roles and permissions", transcribed independently of MATRIX: which roles hold each action.
// E employee, C ap_clerk, A approver, F finance_manager, K controller_admin, U auditor.
const EXPECTED: Record<Action, string> = {
  "invoice.read": "ECAFKU",
  "invoice.upload": "EC",
  "inbox.ingest": "C",
  "invoice.edit": "C",
  "flag.resolve.data_policy": "C",
  "flag.resolve.fraud": "FK",
  "invoice.submit": "C",
  "invoice.decide": "AFK",
  "delegate.set_own": "AFK",
  "payment.prepare": "C",
  "payment.release": "FK",
  "vendor.read": "ECAFKU",
  "vendor.onboard": "C",
  "vendor.bank_change.request": "C",
  "vendor.approve": "FK",
  "vendor.bank_change.verify": "FK",
  "admin.edit": "K",
  "admin.read": "KU",
  "spend.read": "AFKU",
  "audit.read": "KU",
};
const LETTER: Record<Role, string> = {
  employee: "E",
  ap_clerk: "C",
  approver: "A",
  finance_manager: "F",
  controller_admin: "K",
  auditor: "U",
};

describe("permission matrix", () => {
  const cases = (Object.keys(EXPECTED) as Action[]).flatMap((action) =>
    ROLES.map((role) => [action, role, EXPECTED[action].includes(LETTER[role])] as const),
  );

  it("covers every action in BUILD_PLAN", () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(cases)("%s as %s → %s", (action, role, allowed) => {
    expect(roleCan(role, action)).toBe(allowed);
    // With a context that satisfies any scope, the matrix answer equals the expected one.
    const a = actor(role);
    const d = authorize(a, action, { departmentId: a.departmentId, submittedById: a.userId, stepAssigneeIds: [a.userId] });
    expect(d.ok).toBe(allowed);
    if (!d.ok) expect(d.code).toBe(role === "auditor" && MUTATING_ACTIONS.has(action) ? "READ_ONLY_ROLE" : "FORBIDDEN");
  });

  it("scopes employee reads to own submissions", () => {
    const e = actor("employee", "U020");
    expect(authorize(e, "invoice.read", { submittedById: "U020" }).ok).toBe(true);
    expect(authorize(e, "invoice.read", { submittedById: "U021" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("scopes employee uploads to own department", () => {
    const e = actor("employee", "U020", "D02");
    expect(authorize(e, "invoice.upload", { departmentId: "D02" }).ok).toBe(true);
    expect(authorize(e, "invoice.upload", { departmentId: "D03" }).ok).toBe(false);
  });

  it("lets an approver read own department or invoices with their step", () => {
    const a = actor("approver", "U007", "D01");
    expect(authorize(a, "invoice.read", { departmentId: "D01" }).ok).toBe(true);
    expect(authorize(a, "invoice.read", { departmentId: "D07", stepAssigneeIds: ["U007"] }).ok).toBe(true);
    expect(authorize(a, "invoice.read", { departmentId: "D07", stepAssigneeIds: ["U003"] }).ok).toBe(false);
    expect(authorize(a, "spend.read", { departmentId: "D07" }).ok).toBe(false);
  });

  it("masks vendor bank details by role", () => {
    expect(VENDOR_VIEW).toEqual({
      employee: "names",
      ap_clerk: "bank_last4",
      approver: "no_bank",
      finance_manager: "full",
      controller_admin: "full",
      auditor: "full",
    });
  });
});

const step = (assignedToId: string, decision: StepRecord["decision"] = "pending", extra: Partial<StepRecord> = {}): StepRecord => ({
  assignedToId,
  onBehalfOfId: null,
  decision,
  decidedById: decision === "pending" ? null : assignedToId,
  ...extra,
});

describe("invariants", () => {
  const fm = actor("finance_manager", "U003", "D04");
  const ctrl = actor("controller_admin", "U002", "D04");
  const cfo = actor("controller_admin", "U001", "D08");

  it.each([
    ["requester approving", "U010", "U010", "SELF_APPROVAL"],
    ["someone else's request", "U010", "U030", null],
    ["unknown requester", "U010", null, null],
  ])("SELF_APPROVAL: %s", (_, actorId, requester, code) => {
    const d = checkNotRequester(actor("approver", actorId), requester);
    expect(d.ok ? null : d.code).toBe(code);
  });

  it.each([
    ["assignee on a pending step", step("U007"), "U007", null],
    ["another person's step", step("U007"), "U008", "NOT_YOUR_STEP"],
    ["an already decided step", step("U007", "approved"), "U007", "NOT_YOUR_STEP"],
    ["no step", null, "U007", "NOT_YOUR_STEP"],
  ])("NOT_YOUR_STEP: %s", (_, s, actorId, code) => {
    const d = checkIsAssignee(actor("approver", actorId), s);
    expect(d.ok ? null : d.code).toBe(code);
  });

  it.each([
    ["approved in own name", [step("U003", "approved")], fm, "APPROVER_CANNOT_RELEASE"],
    ["approved as a delegate", [step("U003", "approved", { onBehalfOfId: "U012" })], fm, "APPROVER_CANNOT_RELEASE"],
    ["absent approver on whose behalf a delegate approved", [step("U003", "approved", { onBehalfOfId: "U002" })], ctrl, "APPROVER_CANNOT_RELEASE"],
    ["did not approve", [step("U007", "approved"), step("U003", "approved")], ctrl, null],
    ["held a step that is still pending", [step("U002")], ctrl, null],
  ])("APPROVER_CANNOT_RELEASE: %s", (_, steps, a, code) => {
    const d = checkDidNotApprove(a, steps);
    expect(d.ok ? null : d.code).toBe(code);
  });

  it.each([
    ["finance manager at the limit", fm, 100_000, null],
    ["finance manager over the limit", fm, 100_000.01, "RELEASE_LIMIT"],
    ["controller over the finance limit", ctrl, 250_000, null],
    ["approver", actor("approver"), 10, "RELEASE_LIMIT"],
  ])("RELEASE_LIMIT: %s", (_, a, amount, code) => {
    const d = checkReleaseLimit(a, amount);
    expect(d.ok ? null : d.code).toBe(code);
  });

  it.each([
    ["requester verifying own change", "U003", "U003", "FOUR_EYES"],
    ["second person verifying", "U003", "U004", null],
  ])("FOUR_EYES: %s", (_, actorId, requestedBy, code) => {
    const d = checkFourEyes(actor("finance_manager", actorId), requestedBy);
    expect(d.ok ? null : d.code).toBe(code);
  });

  it.each([
    ["auditor", "auditor" as Role, "READ_ONLY_ROLE"],
    ["controller", "controller_admin" as Role, null],
  ])("READ_ONLY_ROLE: %s", (_, role, code) => {
    const d = checkNotReadOnly(actor(role));
    expect(d.ok ? null : d.code).toBe(code);
  });

  it("auditor is refused any change with READ_ONLY_ROLE", () => {
    expect(authorize(actor("auditor"), "invoice.edit")).toMatchObject({ ok: false, code: "READ_ONLY_ROLE" });
    expect(authorize(actor("auditor"), "audit.read").ok).toBe(true);
  });

  it("combined: decide and release", () => {
    expect(canDecideStep(actor("approver", "U010"), step("U010"), "U010")).toMatchObject({ code: "SELF_APPROVAL" });
    expect(canDecideStep(actor("employee", "U020"), step("U020"), null)).toMatchObject({ code: "FORBIDDEN" });
    expect(canDecideStep(actor("approver", "U007"), step("U007"), "U020").ok).toBe(true);
    // D07 over $10,000: U003 for U012, then U002. Only U001 may release.
    const chain = [step("U003", "approved", { onBehalfOfId: "U012" }), step("U002", "approved")];
    expect(canRelease(fm, chain, 18_758)).toMatchObject({ code: "APPROVER_CANNOT_RELEASE" });
    expect(canRelease(ctrl, chain, 18_758)).toMatchObject({ code: "APPROVER_CANNOT_RELEASE" });
    expect(canRelease(cfo, chain, 18_758).ok).toBe(true);
    expect(canRelease(actor("ap_clerk"), [], 10)).toMatchObject({ code: "FORBIDDEN" });
  });
});
