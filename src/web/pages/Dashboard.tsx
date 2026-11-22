import { Link, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { User } from "@/lib/types";
import type { InvoiceRow, WaitingApproval } from "@/services/read.service";
import { call, get, useLoad } from "../api";
import { org, useSession, useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { A, Badge, Card, Field, PageTitle, Pager, Show, Table, Td, btn, btnLight, input, pageOf, pageParam } from "../components/ui";

type Pending = { href: string; ref: string; vendor: string | null; number: string | null; total: number | null; currency: string; waiting_on: string | null; note: string | null };

// The dashboard: counts for the user's role, what is pending approval, department spend, and the delegate form.
export function Dashboard() {
  const user = useUser();
  const { refresh } = useSession();
  const load = useLoad(() => loadDashboard(user), user.status);
  const [sp] = useSearchParams();
  const page = pageParam(sp.get("page"));
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
                  {pageOf(pending, page).map((p) => (
                    <tr key={p.ref}>
                      <Td><A href={p.href}>{p.ref}</A>{p.note && <div className="muted text-xs">{p.note}</div>}</Td>
                      <Td>{p.vendor} {p.number}</Td>
                      <Td className="whitespace-nowrap">{money(p.total, p.currency)}</Td>
                      <Td>{p.waiting_on === "you" ? <Badge tone="gold">you</Badge> : p.waiting_on}</Td>
                    </tr>
                  ))}
                </Table>
                <Pager param="page" page={page} total={pending.length} />
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

  const [rawWork, toReview, waiting, approved, scheduled, vendorsPending, openChanges, othersPending, spend, users] = await Promise.all([
    when(can(user, "parsed.review"), () => get<{ reading: number; needs: number; waiting: number; todo: number }>(at("/raw-items/attention")), null),
    when(can(user, "parsed.review"), () => count("/parsed-invoices?size=1"), 0),
    when(can(user, "approval.act"), () => get<WaitingApproval[]>(at("/approvals?waiting_on=me")), []),
    when(can(user, "payment.prepare"), () => count("/invoices?status=approved&type=invoice&size=1"), 0),
    when(can(user, "payment.release"), () => count("/payments?status=scheduled&size=1"), 0),
    when(can(user, "vendor.approve"), () => count("/vendors?status=pending_review&size=1"), 0),
    when(can(user, "vendor.approve"), () => get<unknown[]>(at("/bank-changes?open=true")).then((r) => r.length), 0),
    when(!can(user, "approval.act"), () => get<InvoiceRow[]>(at("/invoices?status=pending_approval&size=100")), []),
    get<{ department: string; month: string; total: number }[]>(at("/department-spend")),
    when(can(user, "delegate.set"), () => get<User[]>(at("/user-choices")), []),
  ]);

  const tiles: { label: string; value: number; href: string }[] = [];
  // the AP clerk's queue: invoices to check and approve, emails and uploads nobody has dealt with, and requests still out
  if (can(user, "parsed.review") && rawWork) {
    tiles.push({ label: "Invoices to review", value: toReview, href: "/invoices#parsed" });
    tiles.push({ label: "Emails needing attention", value: rawWork.needs, href: "/invoices?raw=needs#raw" });
    tiles.push({ label: "Waiting on a sender", value: rawWork.waiting, href: "/invoices?raw=waiting#raw" });
  }
  if (can(user, "approval.act")) tiles.push({ label: "Waiting for your approval", value: waiting.length, href: "/invoices#invoices" });
  if (can(user, "payment.prepare")) tiles.push({ label: "Approved, not yet scheduled", value: approved, href: "/payments#ready" });
  if (can(user, "payment.release")) tiles.push({ label: "Payments to release", value: scheduled, href: "/payments?status=scheduled#payments" });
  if (can(user, "vendor.approve")) {
    tiles.push({ label: "Vendors pending approval", value: vendorsPending, href: "/vendors?status=pending_review" });
    tiles.push({ label: "Bank changes pending", value: openChanges, href: "/vendors" });
  }

  // Invoice steps waiting on you (or someone you cover); for those who approve nothing, the invoices they can see still being approved.
  const pending: Pending[] = [
    ...waiting.map((a) => ({
      href: `/invoices/${a.invoice_id}`, ref: a.invoice_id, vendor: a.vendor_name, number: a.vendor_invoice_number, total: a.total, currency: a.currency,
      waiting_on: "you", note: a.on_behalf_of ? `on behalf of ${a.on_behalf_of}` : null,
    })),
    ...othersPending.map((i) => ({
      href: `/invoices/${i.invoice_id}`, ref: i.invoice_id, vendor: i.vendor_name, number: i.vendor_invoice_number, total: i.total, currency: i.currency,
      waiting_on: i.waiting_on, note: null,
    })),
  ];
  const colleagues = users.filter((u) => u.status === "active" && u.user_id !== user.user_id && APPROVER_ROLES.includes(u.role));
  return { tiles, pending, spend, colleagues };
}
