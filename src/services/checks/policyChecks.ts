import { query } from "@/lib/db";
import { roleHolder } from "../approvalRouting.service";
import { activePolicies } from "../policy.service";
import { money } from "@/lib/format";
import { invoiceNumberCore } from "@/lib/normalize";
import { type CheckContext, type Flag } from "./types";

const SPLIT_WINDOW_DAYS = 3;

export async function policyChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, db } = ctx;
  const flags: Flag[] = [];
  const total = d.total_cad ?? 0;

  // Split invoices: same vendor, dates within 3 days, each at or under an amount at which approval policies add approvers,
  // together over it. Of those amounts, the highest the invoices exceed together is the one reported.
  const thresholds = (await activePolicies(db, ctx.organizationId, "invoice"))
    .filter((p) => p.field === "invoice_total" && p.operator === ">")
    .map((p) => Number(p.value))
    .sort((a, b) => b - a);
  if (thresholds.length && d.vendor_id && d.invoice_date && total > 0) {
    const rows = await query<{ ref: string; total_cad: number; number: string | null }>(
      `SELECT invoice_id AS ref, total_cad, vendor_invoice_number AS number FROM invoices
         WHERE organization_id=$1 AND vendor_id=$2 AND status NOT IN ('rejected','void')
           AND abs(invoice_date - $3::date) <= $4 AND total_cad > 0
       UNION ALL
       SELECT p.parsed_invoice_id, (p.invoice_json->>'total_cad')::numeric, p.invoice_json->>'vendor_invoice_number' FROM parsed_invoices p
         WHERE p.organization_id=$1 AND p.status='pending' AND p.parsed_invoice_id<>$5
           AND p.invoice_json->>'vendor_id'=$2 AND abs((p.invoice_json->>'invoice_date')::date - $3::date) <= $4
           AND (p.invoice_json->>'total_cad')::numeric > 0`,
      [ctx.organizationId, d.vendor_id, d.invoice_date, SPLIT_WINDOW_DAYS, ctx.parsedInvoiceId],
      db,
    );
    // an invoice with the same number is this one billed again (the duplicate checks flag it), not a second purchase
    const core = invoiceNumberCore(d.vendor_invoice_number);
    const others = rows.filter((r) => !core || invoiceNumberCore(r.number) !== core);
    for (const threshold of thresholds) {
      if (total > threshold) break;
      const near = others.filter((r) => Number(r.total_cad) <= threshold);
      const combined = near.reduce((s, r) => s + Number(r.total_cad), total);
      if (!near.length || combined <= threshold) continue;
      flags.push({
        check_code: "split_invoice",
        category: "policy",
        severity: "blocking",
        message: `With ${near.map((r) => r.ref).join(", ")} from the same vendor within ${SPLIT_WINDOW_DAYS} days, the total is ${money(combined)}: each is at or under the ${money(threshold)} approval threshold, together over it. The approval chain uses the combined total.`,
        evidence: { related: near.map((r) => r.ref), combined, threshold },
      });
      break;
    }
  }

  // Requester is the department's approver (P07): the step goes to that approver's manager.
  if (d.requester_user_id && d.department_id) {
    if ((await roleHolder(db, ctx.organizationId, "dept_manager", d.department_id)) === d.requester_user_id) {
      flags.push({ check_code: "requester_is_approver", category: "policy", severity: "info", message: `The requester (${d.requester_user_id}) manages this department, so their step goes to their manager.` });
    }
  }
  return flags;
}
