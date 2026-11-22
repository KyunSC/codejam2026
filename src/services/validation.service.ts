import { Db, query, one, nextId } from "@/lib/db";
import { today } from "@/lib/dates";
import type { InvoiceData } from "@/lib/types";
import type { RawItem } from "./rawIntake.service";
import type { CheckContext, Flag, Vendor } from "./checks/types";
import { vendorChecks } from "./checks/vendorChecks";
import { poChecks } from "./checks/poChecks";
import { contractChecks } from "./checks/contractChecks";
import { taxChecks } from "./checks/taxChecks";
import { mathChecks } from "./checks/mathChecks";
import { dateChecks } from "./checks/dateChecks";
import { policyChecks } from "./checks/policyChecks";
import { fraudChecks } from "./checks/fraudChecks";
import { detectDuplicates } from "./duplicateDetection.service";
import { conditionText, matches } from "@/lib/policies";
import { activePolicies, invoiceFacts } from "./policy.service";

export async function buildContext(db: Db, organizationId: string, parsedInvoiceId: string, sha256: string | null, data: InvoiceData, raw: RawItem): Promise<CheckContext> {
  const org = (await one<{ legal_name: string; gst_hst_number: string | null }>("SELECT legal_name, gst_hst_number FROM organizations WHERE organization_id=$1", [organizationId], db))!;
  const vendor = data.vendor_id ? await one<Vendor>("SELECT * FROM vendors WHERE vendor_id=$1", [data.vendor_id], db) : null;
  return { db, organizationId, org, data, parsedInvoiceId, sha256, raw, vendor, asOf: today() };
}

// Every active invoice policy that applies and requires a hold blocks the invoice.
async function policyHolds(ctx: CheckContext, flags: Flag[]): Promise<Flag[]> {
  const facts = await invoiceFacts(ctx.db, { total_cad: ctx.data.total_cad ?? null, vendor_id: ctx.data.vendor_id ?? null, invoice_id: null }, flags);
  return (await activePolicies(ctx.db, ctx.organizationId, "invoice"))
    .filter((p) => p.required.includes("hold") && matches(p, facts))
    .map((p): Flag => ({ check_code: "policy_hold", category: "policy", severity: "blocking", message: `Held by policy ${p.rule_id}: ${conditionText(p)}.` }));
}

// Step 4 (checks) and step 5 (duplicates). Flags the clerk already resolved stay resolved when the same problem comes back.
export async function runChecks(ctx: CheckContext, extra: Flag[] = []): Promise<Flag[]> {
  // one database client inside a transaction: the checks run one after another
  const groups: Flag[][] = [];
  for (const check of [vendorChecks, poChecks, contractChecks, taxChecks, mathChecks, dateChecks, policyChecks, fraudChecks, detectDuplicates]) {
    groups.push(await check(ctx));
  }
  const flags = [...extra, ...groups.flat()];
  flags.push(...(await policyHolds(ctx, flags)));
  const previous = await query<{ check_code: string; message: string; status: string; resolved_by: string; resolved_at: string; resolution_note: string }>(
    "SELECT check_code, message, status, resolved_by, resolved_at, resolution_note FROM invoice_flags WHERE parsed_invoice_id=$1 AND status<>'open'",
    [ctx.parsedInvoiceId],
    ctx.db,
  );
  await query("DELETE FROM invoice_flags WHERE parsed_invoice_id=$1", [ctx.parsedInvoiceId], ctx.db);
  for (const f of flags) {
    const kept = previous.find((p) => p.check_code === f.check_code && p.message === f.message);
    await query(
      `INSERT INTO invoice_flags (flag_id, parsed_invoice_id, line_no, check_code, category, severity, message, evidence_json, related_invoice_id, related_card_txn_ref,
         status, resolved_by, resolved_at, resolution_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        await nextId("FLG", ctx.db), ctx.parsedInvoiceId, f.line_no ?? null, f.check_code, f.category, f.severity, f.message,
        f.evidence ? JSON.stringify(f.evidence) : null, f.related_invoice_id ?? null, f.related_card_txn_ref ?? null,
        kept?.status ?? "open", kept?.resolved_by ?? null, kept?.resolved_at ?? null, kept?.resolution_note ?? null,
      ],
      ctx.db,
    );
  }
  return flags;
}
