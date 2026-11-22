import { Db, query, one, nextId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import type { User } from "@/lib/types";

type Policy = { rule_id: string; rule_type: string; trigger_type: string; trigger_value: number | null; step_role: string | null; is_active: boolean };

const ROLE_ORDER = ["dept_manager", "finance_manager", "controller", "cfo"];

// Step 6: the chain is built from the approval_policies rows.
export async function startApprovalChain(db: Db, actor: User, invoiceId: string) {
  const inv = (await one<{ organization_id: string; total_cad: number; department_id: string | null; requester_user_id: string | null; vendor_id: string; parsed_invoice_id: string }>(
    "SELECT organization_id, total_cad, department_id, requester_user_id, vendor_id, parsed_invoice_id FROM invoices WHERE invoice_id=$1",
    [invoiceId],
    db,
  ))!;
  const policies = await query<Policy>("SELECT * FROM approval_policies WHERE organization_id=$1 AND is_active", [inv.organization_id], db);
  const vendor = await one<{ status: string; category: string | null }>("SELECT status, category FROM vendors WHERE vendor_id=$1", [inv.vendor_id], db);
  const flags = await query<{ check_code: string; evidence_json: { combined?: number } | null }>(
    "SELECT check_code, evidence_json FROM invoice_flags WHERE parsed_invoice_id=$1",
    [inv.parsed_invoice_id],
    db,
  );
  // Split invoices: the chain uses the combined total.
  const amount = Math.max(Math.abs(inv.total_cad ?? 0), ...flags.filter((f) => f.check_code === "split_invoice").map((f) => f.evidence_json?.combined ?? 0));

  const steps: { role: string; rule: string }[] = [];
  const add = (role: string | null, rule: string) => role && !steps.some((s) => s.role === role) && steps.push({ role, rule });
  for (const p of policies.filter((p) => p.rule_type === "approval" || p.rule_type === "match")) {
    if (p.trigger_type === "always") add(p.step_role, p.rule_id);
    if (p.trigger_type === "amount_over" && p.trigger_value != null && amount > p.trigger_value) add(p.step_role, p.rule_id);
    if (p.trigger_type === "vendor_pending" && vendor?.status === "pending_review") add(p.step_role, p.rule_id);
    if (p.trigger_type === "vendor_category" && vendor?.category === "Legal") add(p.step_role, p.rule_id);
    if (p.trigger_type === "po_over_balance" && flags.some((f) => f.check_code === "po_over_balance")) add(p.step_role, p.rule_id);
  }
  if (!steps.length) steps.push({ role: "dept_manager", rule: "default" });
  steps.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  const hasPolicy = (t: string) => policies.some((p) => p.trigger_type === t);
  let stepNo = 0;
  for (const s of steps) {
    stepNo++;
    const original = await userForRole(db, inv.organization_id, s.role, inv.department_id);
    const { assigned, reason } = await reassign(db, original, inv.requester_user_id, { selfApproval: hasPolicy("requester_is_approver"), onLeave: hasPolicy("approver_on_leave") });
    if (!assigned) throw new ValidationError(s.role === "dept_manager" ? "The invoice's department has no manager to approve it." : `Nobody holds the ${s.role.replace(/_/g, " ")} role to approve this invoice.`);
    await query(
      `INSERT INTO approvals (approval_id, invoice_id, step_no, rule_id, assigned_user_id, original_user_id, reassign_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [await nextId("APR", db), invoiceId, stepNo, s.rule, assigned, original, reason, stepNo === 1 ? "pending" : "waiting"],
      db,
    );
  }
  await writeAudit(db, { organizationId: inv.organization_id, actor, action: "approval.chain_start", entityType: "invoice", entityId: invoiceId, invoiceId, after: steps });
}

// The person who holds an approval role: the department's manager, or the organization's finance manager, controller or CFO.
export async function userForRole(db: Db, orgId: string, role: string, departmentId: string | null): Promise<string | null> {
  if (role === "dept_manager") {
    const d = departmentId ? await one<{ manager_user_id: string }>("SELECT manager_user_id FROM departments WHERE department_id=$1", [departmentId], db) : null;
    return d?.manager_user_id ?? null;
  }
  const sql: Record<string, string> = {
    finance_manager: "role='finance_manager'",
    controller: "role='controller_admin' AND title ILIKE '%controller%'",
    cfo: "role='controller_admin' AND title ILIKE '%chief financial%'",
  };
  const u = await one<{ user_id: string }>(
    `SELECT user_id FROM users WHERE organization_id=$1 AND ${sql[role] ?? "false"} AND status<>'terminated' ORDER BY approval_limit_cad DESC LIMIT 1`,
    [orgId],
    db,
  );
  return u?.user_id ?? null;
}

// P07: requester is the approver → the approver's manager. P08: on leave → delegate. Terminated → manager.
async function reassign(db: Db, userId: string | null, requesterId: string | null, opts: { selfApproval: boolean; onLeave: boolean }) {
  let assigned = userId;
  let reason: "delegate" | "requester_is_approver" | "terminated" | null = null;
  for (let i = 0; i < 5 && assigned; i++) {
    const u = await one<{ user_id: string; manager_id: string | null; status: string; delegate_user_id: string | null }>(
      "SELECT user_id, manager_id, status, delegate_user_id FROM users WHERE user_id=$1",
      [assigned],
      db,
    );
    if (!u) break;
    if (opts.selfApproval && u.user_id === requesterId && u.manager_id) {
      assigned = u.manager_id;
      reason = "requester_is_approver";
    } else if (u.status === "terminated" && u.manager_id) {
      assigned = u.manager_id;
      reason = "terminated";
    } else if (opts.onLeave && u.status === "on_leave" && u.delegate_user_id) {
      assigned = u.delegate_user_id;
      reason = "delegate";
    } else break;
  }
  return { assigned, reason };
}
