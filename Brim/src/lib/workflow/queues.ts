/**
 * Work queues read by the landing pages. Read-only.
 */
import type { User } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { personId } from "./refs";

/**
 * Approval steps waiting on this person: the current (lowest pending) step of an invoice in
 * pending_approval, assigned to them, or to someone on leave who named them as delegate.
 */
export async function waitingForMe(user: User) {
  const me = personId(user);
  const absent = await db().user.findMany({
    where: { organizationId: user.organizationId, status: "on_leave", delegateId: user.id },
    select: { id: true, externalId: true, fullName: true },
  });
  const forIds = absent.map(personId);
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
    where: { organizationId: user.organizationId, OR: [{ externalId: { in: behalf } }, { id: { in: behalf } }] },
    select: { id: true, externalId: true, fullName: true },
  });
  const names = Object.fromEntries([...absent, ...people].map((a) => [personId(a), a.fullName]));
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
