import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { tx, query, one } from "@/lib/db";
import { assertCan, assertMember } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { money } from "@/lib/format";
import type { User } from "@/lib/types";

type Step = { approval_id: string; invoice_id: string; step_no: number; assigned_user_id: string | null; original_user_id: string | null; reassign_reason: string | null; status: string };

// SQL for a step waiting on the user in `param`: assigned to them, or to someone on leave who named them delegate.
// Expects approvals as `a` joined to the assignee's users row as `au`. The same rule as canActOn.
export const pendingForUserSql = (param: string) =>
  `a.status='pending' AND (a.assigned_user_id=${param} OR (au.status='on_leave' AND au.delegate_user_id=${param}))`;

// Who may act on a pending step: its assignee, or the assignee's delegate while the assignee is on leave,
// and only within their own approval limit (a delegate's own limit, not the absent approver's).
export async function canActOn(actor: User, step: Step): Promise<{ ok: boolean; onBehalfOf: string | null; reason?: string }> {
  if (step.status !== "pending") return { ok: false, onBehalfOf: null };
  let onBehalfOf: string | null;
  if (step.assigned_user_id === actor.user_id) {
    onBehalfOf = step.reassign_reason === "delegate" ? step.original_user_id : null;
  } else {
    const assignee = step.assigned_user_id
      ? await one<{ status: string; delegate_user_id: string | null }>("SELECT status, delegate_user_id FROM users WHERE user_id=$1", [step.assigned_user_id])
      : null;
    if (!(assignee?.status === "on_leave" && assignee.delegate_user_id === actor.user_id)) return { ok: false, onBehalfOf: null };
    onBehalfOf = step.assigned_user_id;
  }
  const inv = await one<{ total_cad: number | null }>("SELECT total_cad FROM invoices WHERE invoice_id=$1", [step.invoice_id]);
  // an empty limit is no personal cap
  if (actor.approval_limit_cad != null && Math.abs(inv?.total_cad ?? 0) > actor.approval_limit_cad) {
    return { ok: false, onBehalfOf, reason: `This invoice is above your approval limit of ${money(actor.approval_limit_cad)}.` };
  }
  return { ok: true, onBehalfOf };
}

export async function decide(actor: User | null, organizationId: string, approvalId: string, decision: "approved" | "rejected", comment: string | null) {
  assertCan(actor, "approval.act");
  await tx(async (c) => {
    const step = await one<Step>("SELECT * FROM approvals WHERE approval_id=$1 FOR UPDATE", [approvalId], c);
    const inv = step
      ? await one<{ organization_id: string; requester_user_id: string | null; status: string }>(
          "SELECT organization_id, requester_user_id, status FROM invoices WHERE invoice_id=$1",
          [step.invoice_id],
          c,
        )
      : null;
    assertMember(actor, organizationId, { brim: true });
    if (!step || !inv || inv.organization_id !== organizationId) throw new NotFoundError("No such approval step");
    if (inv.requester_user_id === actor.user_id) throw new ForbiddenError("You requested this invoice; it goes to your manager.");
    const { ok, onBehalfOf, reason } = await canActOn(actor, step);
    if (!ok) throw new ForbiddenError(reason ?? "This step is not assigned to you");
    if (decision === "rejected" && !comment?.trim()) throw new ValidationError("Give a reason for the rejection");

    await query("UPDATE approvals SET status=$2, acted_by=$3, on_behalf_of_user_id=$4, comment=$5, acted_at=now() WHERE approval_id=$1", [approvalId, decision, actor.user_id, onBehalfOf, comment], c);
    if (decision === "rejected") {
      await query("UPDATE invoices SET status='rejected' WHERE invoice_id=$1", [step.invoice_id], c);
    } else {
      const next = await one<{ approval_id: string }>("SELECT approval_id FROM approvals WHERE invoice_id=$1 AND status='waiting' ORDER BY step_no LIMIT 1", [step.invoice_id], c);
      if (next) await query("UPDATE approvals SET status='pending' WHERE approval_id=$1", [next.approval_id], c);
      else await query("UPDATE invoices SET status='approved' WHERE invoice_id=$1", [step.invoice_id], c);
    }
    await writeAudit(c, {
      organizationId: inv.organization_id, actor, onBehalfOf, action: `approval.${decision}`, entityType: "approval", entityId: approvalId,
      invoiceId: step.invoice_id, note: comment,
    });
  });
}

export async function setDelegate(actor: User | null, onLeave: boolean, delegateUserId: string | null) {
  assertCan(actor, "delegate.set");
  await tx(async (c) => {
    if (onLeave) {
      const d = delegateUserId ? await one<{ organization_id: string; status: string }>("SELECT organization_id, status FROM users WHERE user_id=$1", [delegateUserId], c) : null;
      if (!d || d.organization_id !== actor.organization_id || d.status !== "active" || delegateUserId === actor.user_id) throw new ValidationError("Pick an active colleague as delegate");
    }
    await query(
      "UPDATE users SET status=$2, status_since=current_date, delegate_user_id=$3 WHERE user_id=$1",
      [actor.user_id, onLeave ? "on_leave" : "active", onLeave ? delegateUserId : null],
      c,
    );
    await writeAudit(c, { organizationId: actor.organization_id, actor, action: onLeave ? "delegate.set" : "delegate.clear", entityType: "user", entityId: actor.user_id, after: { delegateUserId } });
  });
}
