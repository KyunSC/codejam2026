import { Link } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { User } from "@/lib/types";
import type { InvoiceRow, ParsedRow, WaitingApproval } from "@/services/read.service";
import { call, get, useLoad } from "../api";
import { org, useSession, useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { A, Badge, Card, Field, PageTitle, Show, Table, Td, btn, btnLight, input } from "../components/ui";

type Pending = { href: string; ref: string; vendor: string | null; number: string | null; total: number | null; currency: string; waiting_on: string | null; note: string | null };

// The dashboard: counts for the user's role, what is pending approval, department spend, and the delegate form.
export function Dashboard() {
  const user = useUser();
  const { refresh } = useSession();
  const load = useLoad(() => loadDashboard(user), user.status);
  const setLeave = async (fd: FormData) => {
    if (fd.get("on_leave") === "1") await call("PUT", "/api/me/delegation", { delegate_user_id: str(fd, "delegate_user_id") });
    else await call("DELETE", "/api/me/delegation");
    await refresh();
  };

  return (
    <Show load={load}>
      {({ tiles, pending, spend, colleagues }) => {
        const months = [...new Set(spend.map((s) => s.month))];
        const depts = [...new Set(spend.map((s) => s.department))];
        return (
          <div className="space-y-6">
            <PageTitle sub={`${user.title ?? ""}`}>Good day, {user.full_name.split(" ")[0]}</PageTitle>
            {tiles.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {tiles.map((t) => (
                  <Link key={t.label} to={t.href} className="card p-4">
                    <div className="heading num text-4xl leading-none">{t.value}</div>
                    <div className="label muted mt-2 text-xs">{t.label}</div>
                  </Link>
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
                    <ApiForm submit={setLeave}>
                      <p className="mb-2 text-sm">You are on leave; your approvals go to your delegate.</p>
                      <input type="hidden" name="on_leave" value="0" />
                      <button className={btnLight}>I&apos;m back</button>
                    </ApiForm>
                  ) : (
                    <ApiForm submit={setLeave} className="flex items-end gap-2">
                      <input type="hidden" name="on_leave" value="1" />
                      <Field label="Delegate">
                        <select name="delegate_user_id" className={input} required>
                          <option value="">Choose…</option>
                          {colleagues.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
                        </select>
                      </Field>
                      <button className={btn}>Go on leave</button>
                    </ApiForm>
                  )}
                </Card>
              )}
            </div>
          </div>
        );
      }}
    </Show>
  );
}

const APPROVER_ROLES = ["approver", "finance_manager", "controller_admin"];

// Each part from its own endpoint, asked only when the user's role shows it.
async function loadDashboard(user: User) {
  const at = (path: string) => org(user, path);
  const count = (path: string) => get<{ total_count: number }[]>(at(path)).then((rows) => rows[0]?.total_count ?? 0);
  const when = <T,>(ok: boolean, f: () => Promise<T>, empty: T) => (ok ? f() : Promise.resolve(empty));

  const [rawNew, parsed, waiting, approved, scheduled, vendorsPending, openChanges, othersPending, spend, users] = await Promise.all([
    when(can(user, "raw.extract"), () => count("/raw-items?status=new&size=1"), 0),
    when(can(user, "parsed.review") || can(user, "raw.extract"), () => get<ParsedRow[]>(at("/parsed-invoices?size=100")), []),
    when(can(user, "approval.act"), () => get<WaitingApproval[]>(at("/approvals?waiting_on=me")), []),
    when(can(user, "payment.prepare"), () => count("/invoices?status=approved&type=invoice&size=1"), 0),
    when(can(user, "payment.release"), () => count("/payments?status=scheduled&size=1"), 0),
    when(can(user, "vendor.approve"), () => get<unknown[]>(at("/vendors?status=pending_review")).then((r) => r.length), 0),
    when(can(user, "vendor.approve"), () => get<unknown[]>(at("/bank-changes?open=true")).then((r) => r.length), 0),
    when(!can(user, "approval.act") && !can(user, "parsed.review"), () => get<InvoiceRow[]>(at("/invoices?status=pending_approval&size=100")), []),
    get<{ department: string; month: string; total: number }[]>(at("/department-spend")),
    when(can(user, "delegate.set"), () => get<User[]>(at("/users")), []),
  ]);

  const tiles: { label: string; value: number; href: string }[] = [];
  if (can(user, "raw.extract")) {
    tiles.push({ label: "Raw items to extract", value: rawNew, href: "/invoices" });
    tiles.push({ label: "Parsed invoices to review", value: parsed[0]?.total_count ?? 0, href: "/invoices" });
  }
  if (can(user, "approval.act")) tiles.push({ label: "Waiting for your approval", value: waiting.length, href: "/invoices" });
  if (can(user, "payment.prepare")) tiles.push({ label: "Approved, not yet scheduled", value: approved, href: "/invoices?status=approved" });
  if (can(user, "payment.release")) tiles.push({ label: "Payments to release", value: scheduled, href: "/payments" });
  if (can(user, "vendor.approve")) {
    tiles.push({ label: "Vendors pending approval", value: vendorsPending, href: "/vendors" });
    tiles.push({ label: "Bank changes pending", value: openChanges, href: "/vendors" });
  }

  // Invoice steps waiting on you (or someone you cover), parsed invoices for the clerk, otherwise the invoices you can see still being approved.
  const pending: Pending[] = [
    ...waiting.map((a) => ({
      href: `/invoices/${a.invoice_id}`, ref: a.invoice_id, vendor: a.vendor_name, number: a.vendor_invoice_number, total: a.total, currency: a.currency,
      waiting_on: "you", note: a.on_behalf_of ? `on behalf of ${a.on_behalf_of}` : null,
    })),
    ...(can(user, "parsed.review") ? parsed : []).map((p) => ({
      href: `/invoices/${p.parsed_invoice_id}`, ref: p.parsed_invoice_id, vendor: p.vendor_name ?? p.invoice_json.vendor_name, number: p.invoice_json.vendor_invoice_number,
      total: p.invoice_json.total, currency: p.invoice_json.currency ?? "CAD", waiting_on: "you", note: "parsed, to approve into invoices",
    })),
    ...othersPending.map((i) => ({
      href: `/invoices/${i.invoice_id}`, ref: i.invoice_id, vendor: i.vendor_name, number: i.vendor_invoice_number, total: i.total, currency: i.currency,
      waiting_on: i.waiting_on, note: null,
    })),
  ];
  const colleagues = users.filter((u) => u.status === "active" && u.user_id !== user.user_id && APPROVER_ROLES.includes(u.role));
  return { tiles, pending, spend, colleagues };
}
