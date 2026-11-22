import type { Role, User } from "./types";

export type Action =
  | "org.manage"
  | "raw.submit"
  | "raw.poll"
  | "raw.extract"
  | "parsed.review"
  | "invoice.view_all"
  | "invoice.view_department"
  | "approval.act"
  | "delegate.set"
  | "payment.view"
  | "payment.prepare"
  | "payment.release"
  | "payment.simulate"
  | "vendor.view"
  | "vendor.onboard"
  | "vendor.approve"
  | "bank_change.request"
  | "bank_change.approve"
  | "users.manage"
  | "policies.manage"
  | "audit.view";

const PERMISSIONS: Record<Role, Action[]> = {
  brim_employee: ["org.manage"],
  employee: ["raw.submit"],
  ap_clerk: [
    "raw.submit", "raw.poll", "raw.extract", "parsed.review", "invoice.view_all",
    "payment.view", "payment.prepare", "payment.simulate",
    "vendor.view", "vendor.onboard", "bank_change.request",
  ],
  approver: ["raw.submit", "invoice.view_department", "approval.act", "delegate.set"],
  finance_manager: [
    "raw.submit", "invoice.view_all", "approval.act", "delegate.set",
    "payment.view", "payment.release", "vendor.view", "vendor.approve", "bank_change.request", "bank_change.approve",
  ],
  controller_admin: [
    "raw.submit", "invoice.view_all", "approval.act", "delegate.set",
    "payment.view", "payment.release", "vendor.view", "vendor.approve", "bank_change.approve",
    "users.manage", "policies.manage", "audit.view",
  ],
  auditor: ["invoice.view_all", "payment.view", "vendor.view", "audit.view"],
};

export class ForbiddenError extends Error {
  status = 403;
}

export function can(user: User | null, action: Action): boolean {
  return !!user && user.status !== "terminated" && PERMISSIONS[user.role].includes(action);
}

export function assertCan(user: User | null, action: Action): asserts user is User {
  if (!can(user, action)) throw new ForbiddenError(`Not allowed: ${action}`);
}

export function assertOrg(user: User, organizationId: string | null | undefined) {
  if (user.role === "brim_employee") return;
  if (!organizationId || user.organization_id !== organizationId) throw new ForbiddenError("Other organization");
}

// Which invoices a user may see, as a SQL condition on table alias i.
export function invoiceScope(user: User, alias = "i"): { sql: string; params: unknown[] } {
  if (can(user, "invoice.view_all")) return { sql: `${alias}.organization_id = $1`, params: [user.organization_id] };
  const deptClause = can(user, "invoice.view_department") ? ` OR ${alias}.department_id = $3` : "";
  return {
    sql: `${alias}.organization_id = $1 AND (${alias}.requester_user_id = $2 OR ${alias}.created_by = $2${deptClause}
      OR EXISTS (SELECT 1 FROM approvals a WHERE a.invoice_id = ${alias}.invoice_id AND (a.assigned_user_id = $2 OR a.original_user_id = $2)))`,
    params: deptClause ? [user.organization_id, user.user_id, user.department_id] : [user.organization_id, user.user_id],
  };
}
