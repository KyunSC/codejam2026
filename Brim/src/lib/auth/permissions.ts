/**
 * What each role may do. The pages use these to show or hide things, and the API checks the
 * same functions on the server. A Brim admin (staff login or admin token) may do all of it.
 */
import type { Role } from "@/generated/prisma/client";
import type { Caller } from "@/lib/context";
import { AppError } from "@/lib/http";

const can = (roles: Role[]) => (role: Role | null | undefined) => !!role && roles.includes(role);

/** Settings: approve access requests, add and edit users. */
export const canManageUsers = can(["controller_admin"]);
/** The full audit log. */
export const canViewAudit = can(["controller_admin", "auditor"]);
/** Every invoice in the organization, not just their own. */
export const canReadAllInvoices = can(["ap_clerk", "finance_manager", "controller_admin", "auditor"]);
/** Bring invoices in: an employee submits for their department, an AP clerk uploads. */
export const canCreateInvoices = can(["employee", "ap_clerk"]);
/** Read the AP inbox. */
export const canIngestInbox = can(["ap_clerk"]);

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  ap_clerk: "AP clerk",
  approver: "Approver",
  finance_manager: "Finance manager",
  controller_admin: "Controller / admin",
  auditor: "Auditor",
};

/** Throws 403 unless the caller is a Brim admin or their role passes `check`. */
export function requirePermission(caller: Caller, check: (role: Role) => boolean, what: string): void {
  if (caller.actor.type === "brim_admin") return;
  if (!caller.user || !check(caller.user.role)) {
    throw new AppError(403, "FORBIDDEN", `Your role can't ${what}.`);
  }
}
