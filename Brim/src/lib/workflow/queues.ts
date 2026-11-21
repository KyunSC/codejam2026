/**
 * Work queues read by the landing pages. Read-only.
 */
import type { User } from "@/generated/prisma/client";
import type { Role } from "@/lib/types";
import { db } from "@/lib/db";

/**
 * Approval steps waiting on this person: the current (lowest pending) step of an invoice in
 * pending_approval, assigned to them, or to someone on leave who named them as delegate.
 */
export async function waitingForMe(user: User) {
  const me = user.id;
  const absent = await db().user.findMany({
    where: { organizationId: user.organizationId, status: "on_leave", delegateId: user.id },
    select: { id: true, externalId: true, fullName: true },
  });
  const forIds = absent.map((a) => a.id);
  const steps = await db().approvalStep.findMany({
    where: {
      organizationId: user.organizationId,
      decision: "pending",
      assignedToId: { in: [me, ...forIds] },
      invoice: { status: "pending_approval" },
    },
    include: {
      invoice: {
        select: {
          id: true, vendorName: true, vendorId: true, invoiceNumber: true, total: true, totalCad: true, currency: true,
          departmentId: true, dueDate: true, approvalSteps: { select: { stepNo: true, decision: true }, orderBy: { stepNo: "asc" } },
        },
      },
    },
    orderBy: [{ invoice: { dueDate: "asc" } }],
  });
  // Only the step the invoice is waiting on now.
  const current = steps.filter((s) => s.invoice.approvalSteps.find((x) => x.decision === "pending")?.stepNo === s.stepNo);
  const behalf = [...new Set(current.map((s) => s.onBehalfOfId).filter((x): x is string => !!x))];
  const people = await db().user.findMany({
    where: { organizationId: user.organizationId, id: { in: behalf } },
    select: { id: true, externalId: true, fullName: true },
  });
  const names = Object.fromEntries([...absent, ...people].map((a) => [a.id, a.fullName]));
  return current.map((s) => ({
    stepId: s.id,
    stepNo: s.stepNo,
    stepCount: s.invoice.approvalSteps.length,
    role: s.role,
    why: s.why as { ruleIds: string[]; replacements: string[] },
    actingFor: s.assignedToId !== me ? (names[s.assignedToId] ?? s.assignedToId) : s.onBehalfOfId ? (names[s.onBehalfOfId] ?? s.onBehalfOfId) : null,
    invoice: s.invoice,
  }));
}

// ---------- Landing pages and queues by role (BUILD_PLAN Screens) ----------


/** Where each role lands: its own work. */
export const LANDING: Record<Role, string> = {
  employee: "/invoices",
  ap_clerk: "/review",
  approver: "/approvals",
  finance_manager: "/approvals",
  controller_admin: "/approvals",
  auditor: "/audit",
};

/** Navigation by role: only what the role can open. */
export function navFor(role: Role): Array<{ label: string; href: string }> {
  switch (role) {
    case "employee":
      return [{ label: "My submissions", href: "/invoices" }, { label: "Vendors", href: "/vendors" }];
    case "ap_clerk":
      return [
        { label: "Review queue", href: "/review" },
        { label: "Invoices", href: "/invoices" },
        { label: "Payments", href: "/payments" },
        { label: "Vendors", href: "/vendors" },
      ];
    case "approver":
      return [{ label: "Waiting for me", href: "/approvals" }, { label: "Invoices", href: "/invoices" }, { label: "Vendors", href: "/vendors" }];
    case "finance_manager":
      return [
        { label: "Waiting for me", href: "/approvals" },
        { label: "Payments", href: "/payments" },
        { label: "Invoices", href: "/invoices" },
        { label: "Vendors", href: "/vendors" },
      ];
    case "controller_admin":
      return [
        { label: "Waiting for me", href: "/approvals" },
        { label: "Payments", href: "/payments" },
        { label: "Invoices", href: "/invoices" },
        { label: "Vendors", href: "/vendors" },
        { label: "Policies", href: "/policies" },
        { label: "Settings", href: "/settings" },
        { label: "Audit log", href: "/audit" },
      ];
    case "auditor":
      return [
        { label: "Audit log", href: "/audit" },
        { label: "Invoices", href: "/invoices" },
        { label: "Payments", href: "/payments" },
        { label: "Vendors", href: "/vendors" },
        { label: "Policies", href: "/policies" },
      ];
  }
}

const REVIEW_STATES = ["received", "extracted", "needs_review", "coded", "rejected"];

/**
 * The AP clerk's review queue: invoices still in review, those with a flag that holds first, then any
 * open flag, then oldest first; and the emails that need a person (no attachment, statements, payment
 * questions, newsletters, and labels that failed).
 */
export async function reviewQueue(organizationId: string) {
  const invoices = await db().invoice.findMany({
    where: { organizationId, source: { not: "history" }, status: { in: REVIEW_STATES } },
    include: {
      flags: { where: { status: "open" }, select: { code: true, effect: true, klass: true } },
      document: { select: { fileName: true } },
      email: { select: { fromAddress: true, subject: true } },
    },
    orderBy: [{ receivedDate: "asc" }, { id: "asc" }],
  });
  const rank = (i: (typeof invoices)[number]) => (i.flags.some((f) => f.effect === "hold") ? 0 : i.flags.length ? 1 : 2);
  const sorted = [...invoices].sort((a, b) => rank(a) - rank(b));
  const emails = await db().inboxEmail.findMany({
    where: {
      organizationId,
      OR: [{ label: { in: ["missing_attachment", "statement", "payment_inquiry", "other"] } }, { label: null, labelReason: { not: null } }],
    },
    orderBy: { receivedAt: "desc" },
  });
  return { invoices: sorted, emails };
}

/** Finance manager / controller work besides approval steps: vendors to approve, bank changes to verify, open fraud flags. */
export async function financeQueue(user: User) {
  const organizationId = user.organizationId;
  const [vendors, bankChanges, fraud] = await Promise.all([
    db().vendor.findMany({ where: { organizationId, status: "pending_review" }, orderBy: { id: "asc" } }),
    db().bankChangeRequest.findMany({ where: { organizationId, status: "pending" }, include: { vendor: { select: { legalName: true } } }, orderBy: { requestedAt: "asc" } }),
    db().flag.count({ where: { organizationId, status: "open", klass: "fraud" } }),
  ]);
  return {
    vendors: vendors.map((v) => ({ id: v.id, legalName: v.legalName, mine: v.createdById === user.id })),
    bankChanges: bankChanges.map((c) => ({ id: c.id, vendorId: c.vendorId, vendorName: c.vendor.legalName, channel: c.channel, mine: c.requestedById === user.id })),
    openFraudFlags: fraud,
  };
}
