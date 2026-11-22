import { Db, query, one, nextId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { matches } from "@/lib/policies";
import type { User } from "@/lib/types";
import { activePolicies, invoiceFacts } from "./policy.service";

type Person = { user_id: string; manager_id: string | null; status: string; delegate_user_id: string | null; approval_limit_cad: number | null };
type Reason = "delegate" | "requester_is_approver" | "terminated" | "over_limit";

// Step 7: who approves an invoice. Every active invoice policy that applies adds its roles; each role's holder
// climbs the org tree until someone may approve; the steps run from the lowest approval limit to the highest.
export async function startApprovalChain(db: Db, actor: User, invoiceId: string) {
  const inv = (await one<{ organization_id: string; total_cad: number; department_id: string | null; requester_user_id: string | null; vendor_id: string; parsed_invoice_id: string }>(
    "SELECT organization_id, total_cad, department_id, requester_user_id, vendor_id, parsed_invoice_id FROM invoices WHERE invoice_id=$1",
    [invoiceId],
    db,
  ))!;
  const flags = await query<{ check_code: string; evidence: Record<string, unknown> | null }>(
    "SELECT check_code, evidence_json AS evidence FROM invoice_flags WHERE parsed_invoice_id=$1",
    [inv.parsed_invoice_id],
    db,
  );
  const facts = await invoiceFacts(db, { ...inv, invoice_id: invoiceId }, flags);

  const roles = new Map<string, string[]>();
  for (const p of (await activePolicies(db, inv.organization_id, "invoice")).filter((p) => matches(p, facts))) {
    for (const role of p.required.filter((r) => r !== "hold")) roles.set(role, [...(roles.get(role) ?? []), p.rule_id]);
  }
  // with every policy switched off, the department manager still approves
  if (!roles.size) roles.set("dept_manager", ["default"]);

  const steps: { assigned: Person; original: string; reason: Reason | null; rules: string }[] = [];
  for (const [role, rules] of roles) {
    const holder = await roleHolder(db, inv.organization_id, role, inv.department_id);
    if (!holder) throw new ValidationError(role === "dept_manager" ? "The invoice's department has no manager to approve it." : `Nobody holds the ${role.replace(/_/g, " ")} role to approve this invoice.`);
    const { assigned, reason } = await climb(db, holder, inv.requester_user_id, facts.invoice_total as number);
    // two roles can climb to the same person: they approve once
    if (!steps.some((s) => s.assigned.user_id === assigned.user_id)) steps.push({ assigned, original: holder, reason, rules: rules.join(",") });
  }
  // lowest limit first; an empty limit is no cap, so last
  steps.sort((a, b) => (a.assigned.approval_limit_cad ?? Infinity) - (b.assigned.approval_limit_cad ?? Infinity));

  for (const [i, s] of steps.entries()) {
    await query(
      `INSERT INTO approvals (approval_id, invoice_id, step_no, rule_id, assigned_user_id, original_user_id, reassign_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [await nextId("APR", db), invoiceId, i + 1, s.rules, s.assigned.user_id, s.original, s.reason, i === 0 ? "pending" : "waiting"],
      db,
    );
  }
  await writeAudit(db, {
    organizationId: inv.organization_id, actor, action: "approval.chain_start", entityType: "invoice", entityId: invoiceId, invoiceId,
    after: steps.map((s) => ({ user_id: s.assigned.user_id, rules: s.rules, reason: s.reason })),
  });
}

// The person who holds an approval role: the department's manager; the finance manager; the controller;
// the CFO, who is the top of the org tree.
export async function roleHolder(db: Db, orgId: string, role: string, departmentId: string | null): Promise<string | null> {
  if (role === "dept_manager") {
    const d = departmentId ? await one<{ manager_user_id: string }>("SELECT manager_user_id FROM departments WHERE department_id=$1", [departmentId], db) : null;
    return d?.manager_user_id ?? null;
  }
  const where: Record<string, string> = {
    finance_manager: "role='finance_manager'",
    controller: "role='controller_admin' AND manager_id IS NOT NULL",
    cfo: "role='controller_admin' AND manager_id IS NULL",
  };
  if (!where[role]) return null;
  const u = await one<{ user_id: string }>(
    `SELECT user_id FROM users WHERE organization_id=$1 AND ${where[role]} AND status<>'terminated' ORDER BY approval_limit_cad DESC NULLS FIRST LIMIT 1`,
    [orgId],
    db,
  );
  return u?.user_id ?? null;
}

// From a role's holder to the person who approves: someone on leave is replaced by their delegate, then whoever is the requester,
// has left, or is over their own approval limit passes the step to their manager, until someone may approve.
async function climb(db: Db, userId: string, requesterId: string | null, amount: number): Promise<{ assigned: Person; reason: Reason | null }> {
  let reason: Reason | null = null;
  let u = (await person(db, userId))!;
  for (let i = 0; i < 10; i++) {
    let next: string | null = null;
    if (u.status === "on_leave" && u.delegate_user_id) [next, reason] = [u.delegate_user_id, "delegate"];
    else if (u.user_id === requesterId) [next, reason] = [u.manager_id, "requester_is_approver"];
    else if (u.status === "terminated") [next, reason] = [u.manager_id, "terminated"];
    else if (u.approval_limit_cad != null && amount > u.approval_limit_cad) [next, reason] = [u.manager_id, "over_limit"];
    else return { assigned: u, reason };
    if (!next) throw new ValidationError(`Nobody above ${u.user_id} may approve this invoice; check managers and approval limits in Settings.`);
    u = (await person(db, next))!;
  }
  throw new ValidationError("The managers and delegates loop; check them in Settings.");
}

const person = (db: Db, userId: string) =>
  one<Person>("SELECT user_id, manager_id, status, delegate_user_id, approval_limit_cad FROM users WHERE user_id=$1", [userId], db);
