/**
 * The server-side guard for workflow routes: the caller as the permission matrix sees them, and a
 * check that throws the matrix's error code as an AppError (BUILD_PLAN "Roles and permissions").
 */
import type { User } from "@/generated/prisma/client";
import type { Actor as AuditActor } from "@/lib/audit";
import {
  type AccessContext,
  type Action,
  type Actor as MatrixActor,
  authorize,
  type Decision,
} from "@/lib/auth/matrix";
import type { Caller } from "@/lib/context";
import { AppError } from "@/lib/http";

export interface WorkflowActor {
  /** The calling user's row. */
  user: User;
  /** For the matrix and the rules: dataset id (U001 …), role, department. */
  matrix: MatrixActor;
  /** For the audit log. */
  audit: AuditActor;
}

export function workflowActor(user: User): WorkflowActor {
  return {
    user,
    // Database space: the matrix and invariants compare against stored row ids (steps, requester, payments).
    matrix: { userId: user.id, role: user.role, departmentId: user.departmentId ?? "" },
    audit: { type: "user", userId: user.id, role: user.role },
  };
}

const STATUS: Record<string, number> = { FORBIDDEN: 403, READ_ONLY_ROLE: 403 };

/** Throws the decision's code: 403 for matrix and invariant failures. */
export function enforce(d: Decision): void {
  if (!d.ok) throw new AppError(STATUS[d.code] ?? 403, d.code, d.message);
}

/** The caller as a workflow actor, after the matrix check. A Brim admin is not a person at the org. */
export function requireAction(caller: Caller, action: Action, ctx: AccessContext = {}): WorkflowActor {
  if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization to do this.");
  const actor = workflowActor(caller.user);
  enforce(authorize(actor.matrix, action, ctx));
  return actor;
}
