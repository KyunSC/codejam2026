import { ForbiddenError, UnauthorizedError } from "./errors";
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
  | "audit.view"
  | "org.settings"
  | "contract.manage"
  | "po.manage";

const PERMISSIONS: Record<Role, Action[]> = {
  brim_employee: ["org.manage"],
  employee: ["raw.submit"],
  ap_clerk: [
    "raw.submit", "raw.poll", "raw.extract", "parsed.review", "invoice.view_all",
    "payment.view", "payment.prepare", "payment.simulate",
    "vendor.view", "vendor.onboard", "bank_change.request", "po.manage",
  ],
  approver: ["raw.submit", "invoice.view_department", "approval.act", "delegate.set"],
  finance_manager: [
    "raw.submit", "invoice.view_all", "approval.act", "delegate.set",
    "payment.view", "payment.release", "vendor.view", "vendor.approve", "bank_change.request", "bank_change.approve",
    "contract.manage", "po.manage",
  ],
  controller_admin: [
    "raw.submit", "invoice.view_all", "approval.act", "delegate.set",
    "payment.view", "payment.release", "vendor.view", "vendor.approve", "bank_change.approve",
    "users.manage", "policies.manage", "audit.view", "org.settings", "contract.manage", "po.manage",
  ],
  auditor: ["invoice.view_all", "payment.view", "vendor.view", "audit.view"],
};

export { ForbiddenError };

export function can(user: User | null, action: Action): boolean {
  return !!user && user.status !== "terminated" && PERMISSIONS[user.role].includes(action);
}

export function assertCan(user: User | null, action: Action): asserts user is User {
  if (!can(user, action)) throw new ForbiddenError(`Not allowed: ${action}`);
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

// For organization-scoped API calls: members act inside their own organization with their role's permission;
// a Brim employee may act on any organization only for setup actions.
const BRIM_SETUP: Action[] = ["org.settings", "users.manage", "policies.manage", "vendor.onboard", "vendor.approve", "contract.manage", "po.manage", "raw.submit", "raw.extract"];

export function authorize(user: User | null, organizationId: string, action: Action): asserts user is User {
  if (!user) throw new UnauthorizedError("Sign in");
  if (user.role === "brim_employee") {
    if (!BRIM_SETUP.includes(action)) throw new ForbiddenError(`Not allowed: ${action}`);
    return;
  }
  if (user.organization_id !== organizationId) throw new ForbiddenError("Other organization");
  assertCan(user, action);
}

export function isBrim(user: User | null) {
  return user?.role === "brim_employee";
}

// The organization addressed must be the user's own. `brim: true` also lets a Brim employee through, for setup reads.
export function assertMember(user: User | null, organizationId: string, opts: { brim?: boolean } = {}): asserts user is User {
  if (!user) throw new UnauthorizedError("Sign in");
  if (user.role === "brim_employee" && opts.brim) return;
  if (user.organization_id !== organizationId) throw new ForbiddenError("Other organization");
}
