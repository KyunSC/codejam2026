import { query } from "@/lib/db";
import { userForRole } from "../approvalRouting.service";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

const SPLIT_WINDOW_DAYS = 3;
const SPLIT_THRESHOLD = 10000;

export async function policyChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, db } = ctx;
  const flags: Flag[] = [];
  const total = d.total_cad ?? 0;

  // Split invoices: same vendor, dates within 3 days, each at or under $10,000, together over it.
  if (d.vendor_id && d.invoice_date && total > 0 && total <= SPLIT_THRESHOLD) {
    const near = await query<{ ref: string; total_cad: number }>(
      `SELECT invoice_id AS ref, total_cad FROM invoices
         WHERE organization_id=$1 AND vendor_id=$2 AND status NOT IN ('rejected','void')
           AND abs(invoice_date - $3::date) <= $4 AND total_cad <= $5 AND total_cad > 0
       UNION ALL
       SELECT p.parsed_invoice_id, (p.invoice_json->>'total_cad')::numeric FROM parsed_invoices p
         WHERE p.organization_id=$1 AND p.status='pending' AND p.parsed_invoice_id<>$6
           AND p.invoice_json->>'vendor_id'=$2 AND abs((p.invoice_json->>'invoice_date')::date - $3::date) <= $4
           AND (p.invoice_json->>'total_cad')::numeric BETWEEN 0.01 AND $5`,
      [ctx.organizationId, d.vendor_id, d.invoice_date, SPLIT_WINDOW_DAYS, SPLIT_THRESHOLD, ctx.parsedInvoiceId],
      db,
    );
    const combined = near.reduce((s, r) => s + Number(r.total_cad), total);
    if (near.length && combined > SPLIT_THRESHOLD) {
      flags.push({
        check_code: "split_invoice",
        category: "policy",
        severity: "warning",
        message: `With ${near.map((r) => r.ref).join(", ")} from the same vendor within ${SPLIT_WINDOW_DAYS} days, the total is ${money(combined)}: each is under the $10,000 limit, together over it. The approval chain uses the combined total.`,
        evidence: { related: near.map((r) => r.ref), combined },
      });
    }
  }

  // Requester is the department's approver (P07): the step goes to that approver's manager.
  if (d.requester_user_id && d.department_id) {
    if ((await userForRole(db, ctx.organizationId, "dept_manager", d.department_id)) === d.requester_user_id) {
      flags.push({ check_code: "requester_is_approver", category: "policy", severity: "info", message: `The requester (${d.requester_user_id}) manages this department, so their step goes to their manager (policy P07).` });
    }
  }
  return flags;
}
