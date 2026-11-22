import { requireUser } from "@/lib/auth";
import { can, invoiceScope } from "@/lib/authz";
import { one, query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Badge, Card, Field, PageTitle, Table, Td, btn, btnLight, input, money } from "@/components/ui";
import { delegateAction } from "../../actions";

export default async function Dashboard() {
  const user = await requireUser();
  const org = user.organization_id;
  const count = async (sql: string, params: unknown[]) => (await one<{ n: number }>(sql, params))?.n ?? 0;

  const tiles: { label: string; value: number; href: string }[] = [];
  if (can(user, "raw.extract")) {
    tiles.push({ label: "Raw items to extract", value: await count("SELECT count(*)::int n FROM raw_items WHERE organization_id=$1 AND status='new'", [org]), href: "/invoices" });
    tiles.push({ label: "Parsed invoices to review", value: await count("SELECT count(*)::int n FROM parsed_invoices WHERE organization_id=$1 AND status='pending'", [org]), href: "/invoices" });
  }
  if (can(user, "approval.act")) {
    tiles.push({
      label: "Waiting for your approval",
      value: await count(
        `SELECT count(*)::int n FROM approvals a LEFT JOIN users au ON au.user_id=a.assigned_user_id
          WHERE a.status='pending' AND (a.assigned_user_id=$1 OR (au.status='on_leave' AND au.delegate_user_id=$1))`,
        [user.user_id],
      ),
      href: "/invoices",
    });
  }
  if (can(user, "payment.prepare")) tiles.push({ label: "Approved, not yet scheduled", value: await count("SELECT count(*)::int n FROM invoices WHERE organization_id=$1 AND status='approved' AND type='invoice'", [org]), href: "/invoices?status=approved" });
  if (can(user, "payment.release")) tiles.push({ label: "Payments to release", value: await count("SELECT count(*)::int n FROM payments WHERE organization_id=$1 AND status='scheduled'", [org]), href: "/payments" });
  if (can(user, "vendor.approve")) {
    tiles.push({ label: "Vendors pending approval", value: await count("SELECT count(*)::int n FROM vendors WHERE organization_id=$1 AND status='pending_review'", [org]), href: "/vendors" });
    tiles.push({ label: "Bank changes pending", value: await count("SELECT count(*)::int n FROM vendor_bank_changes c JOIN vendors v USING (vendor_id) WHERE v.organization_id=$1 AND (c.status='pending' OR NOT c.verified_by_callback)", [org]), href: "/vendors" });
  }

  const scope = invoiceScope(user);
  // What is pending approval: invoice steps waiting on you (or on someone you cover), parsed invoices for the clerk,
  // and otherwise the invoices you can see that are still in their approval chain.
  type Pending = { href: string; ref: string; vendor: string | null; number: string | null; total: number | null; currency: string; waiting_on: string | null; note: string | null };
  const pending: Pending[] = [];
  if (can(user, "approval.act")) {
    pending.push(...(await query<Pending>(
      `SELECT '/invoices/' || i.invoice_id AS href, i.invoice_id AS ref, v.legal_name vendor, i.vendor_invoice_number AS number, i.total, i.currency,
              'you' AS waiting_on, CASE WHEN a.assigned_user_id <> $1 THEN 'on behalf of ' || au.full_name END AS note
         FROM approvals a JOIN invoices i USING (invoice_id) LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN users au ON au.user_id=a.assigned_user_id
        WHERE a.status='pending' AND (a.assigned_user_id=$1 OR (au.status='on_leave' AND au.delegate_user_id=$1)) AND i.requester_user_id IS DISTINCT FROM $1
        ORDER BY i.invoice_date`,
      [user.user_id],
    )));
  }
  if (can(user, "parsed.review")) {
    pending.push(...(await query<Pending>(
      `SELECT '/invoices/' || p.parsed_invoice_id AS href, p.parsed_invoice_id AS ref, COALESCE(v.legal_name, p.invoice_json->>'vendor_name') vendor,
              p.invoice_json->>'vendor_invoice_number' AS number, (p.invoice_json->>'total')::float AS total, COALESCE(p.invoice_json->>'currency','CAD') AS currency,
              'you' AS waiting_on, 'parsed, to approve into invoices' AS note
         FROM parsed_invoices p LEFT JOIN vendors v ON v.vendor_id = p.invoice_json->>'vendor_id'
        WHERE p.organization_id=$1 AND p.status='pending' ORDER BY p.parsed_invoice_id`,
      [org],
    )));
  }
  if (!can(user, "approval.act") && !can(user, "parsed.review")) {
    pending.push(...(await query<Pending>(
      `SELECT '/invoices/' || i.invoice_id AS href, i.invoice_id AS ref, v.legal_name vendor, i.vendor_invoice_number AS number, i.total, i.currency,
              (SELECT u.full_name FROM approvals a JOIN users u ON u.user_id=a.assigned_user_id WHERE a.invoice_id=i.invoice_id AND a.status='pending' LIMIT 1) AS waiting_on,
              NULL AS note
         FROM invoices i LEFT JOIN vendors v ON v.vendor_id=i.vendor_id
        WHERE ${scope.sql} AND i.status='pending_approval' ORDER BY i.invoice_date`,
      scope.params,
    )));
  }
  const spend = can(user, "invoice.view_department") || can(user, "invoice.view_all")
    ? await query<{ department: string; month: string; total: number }>(
        `SELECT d.name department, to_char(i.invoice_date,'YYYY-MM') AS month, sum(i.total_cad)::float AS total FROM invoices i JOIN departments d USING (department_id)
          WHERE i.organization_id=$1 AND i.status NOT IN ('rejected','void') AND ($2::text IS NULL OR i.department_id=$2)
            AND i.invoice_date >= date_trunc('month', $3::date) - interval '2 months'
          GROUP BY 1,2 ORDER BY 1,2`,
        [org, can(user, "invoice.view_all") ? null : user.department_id, process.env.AS_OF_DATE],
      )
    : [];
  const colleagues = can(user, "delegate.set")
    ? await query<{ user_id: string; full_name: string }>("SELECT user_id, full_name FROM users WHERE organization_id=$1 AND status='active' AND user_id<>$2 AND role IN ('approver','finance_manager','controller_admin') ORDER BY full_name", [org, user.user_id])
    : [];
  const months = [...new Set(spend.map((s) => s.month))];
  const depts = [...new Set(spend.map((s) => s.department))];

  return (
    <div className="space-y-6">
      <PageTitle sub={`${user.title ?? ""}`}>Good day, {user.full_name.split(" ")[0]}</PageTitle>
      {tiles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <a key={t.label} href={t.href} className="card p-4">
              <div className="heading num text-4xl leading-none">{t.value}</div>
              <div className="label muted mt-2 text-xs">{t.label}</div>
            </a>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Pending approval (${pending.length})`}>
          <Table head={["Item", "Vendor", "Total", "Waiting on"]} empty="Nothing is waiting for approval.">
            {pending.map((p) => (
              <tr key={p.ref}>
                <Td><A href={p.href}>{p.ref}</A>{p.note && <div className="muted text-xs">{p.note}</div>}</Td>
                <Td>{p.vendor} {p.number}</Td>
                <Td className="whitespace-nowrap">{money(p.total, p.currency)}</Td>
                <Td>{p.waiting_on === "you" ? <Badge tone="gold">you</Badge> : p.waiting_on}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        {spend.length > 0 && (
          <Card title="Spend by department (CAD, last three months)">
            <Table head={["Department", ...months]}>
              {depts.map((dname) => (
                <tr key={dname}>
                  <Td>{dname}</Td>
                  {months.map((m) => <Td key={m}>{money(spend.find((s) => s.department === dname && s.month === m)?.total ?? 0)}</Td>)}
                </tr>
              ))}
            </Table>
          </Card>
        )}

        {can(user, "delegate.set") && (
          <Card title="Away? Delegate your approvals">
            {user.status === "on_leave" ? (
              <ActionForm action={delegateAction}>
                <p className="mb-2 text-sm">You are on leave; your approvals go to your delegate.</p>
                <input type="hidden" name="on_leave" value="0" />
                <button className={btnLight}>I&apos;m back</button>
              </ActionForm>
            ) : (
              <ActionForm action={delegateAction} className="flex items-end gap-2">
                <input type="hidden" name="on_leave" value="1" />
                <Field label="Delegate">
                  <select name="delegate_user_id" className={input} required>
                    <option value="">Choose…</option>
                    {colleagues.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
                  </select>
                </Field>
                <button className={btn}>Go on leave</button>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
