import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, invoiceScope } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Card, PageTitle, Status, Table, Td, btn, btnLight, date, input, money, Field, Badge, Pager, PAGE_SIZE, pageParam } from "@/components/ui";
import { extractAction, pollAction } from "../../actions";
import type { InvoiceData } from "@/lib/types";

type Raw = { total_count: number; raw_item_id: string; kind: string; received_at: string; from_name: string | null; subject: string | null; files: { file_name: string }[]; form_json: InvoiceData | null; status: string; no_invoice_reason: string | null; submitter: string | null };
type Parsed = { total_count: number; parsed_invoice_id: string; raw_item_id: string; file_name: string | null; invoice_json: InvoiceData; status: string; vendor_name: string | null; blocking: number; warnings: number };
type Inv = { total_count: number; invoice_id: string; vendor_name: string | null; vendor_invoice_number: string; invoice_date: string; total: number; currency: string; total_cad: number; department: string | null; status: string; type: string; waiting_on: string | null; mine: boolean };

const RAW_PAGE_SIZE = 5;
const STATUSES = ["all", "pending_approval", "approved", "scheduled", "paid", "rejected"];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "all";
  const seeAllRaw = can(user, "invoice.view_all");
  const rawPage = pageParam(sp.rawPage);
  const rawKind = typeof sp.rawKind === "string" && ["email", "pdf", "form"].includes(sp.rawKind) ? sp.rawKind : null;
  const parsedPage = pageParam(sp.parsedPage);
  const invPage = pageParam(sp.page);

  const raw = await query<Raw>(
    `SELECT r.*, u.full_name AS submitter, count(*) OVER ()::int AS total_count FROM raw_items r LEFT JOIN users u ON u.user_id=r.submitted_by
      WHERE r.organization_id=$1
        AND NOT EXISTS (SELECT 1 FROM parsed_invoices p JOIN invoices i ON i.parsed_invoice_id=p.parsed_invoice_id WHERE p.raw_item_id=r.raw_item_id AND i.is_historical)
      AND ($2::text IS NULL OR r.kind=$2)
      ${seeAllRaw ? "" : "AND r.submitted_by=$3"}
      ORDER BY (r.status='new') DESC, r.received_at DESC LIMIT ${RAW_PAGE_SIZE} OFFSET ${(rawPage - 1) * RAW_PAGE_SIZE}`,
    seeAllRaw ? [user.organization_id, rawKind] : [user.organization_id, rawKind, user.user_id],
  );
  const parsed = await query<Parsed>(
    `SELECT p.*, v.legal_name AS vendor_name, count(*) OVER ()::int AS total_count,
       (SELECT count(*)::int FROM invoice_flags f WHERE f.parsed_invoice_id=p.parsed_invoice_id AND f.severity='blocking' AND f.status='open') AS blocking,
       (SELECT count(*)::int FROM invoice_flags f WHERE f.parsed_invoice_id=p.parsed_invoice_id AND f.severity='warning' AND f.status='open') AS warnings
     FROM parsed_invoices p LEFT JOIN vendors v ON v.vendor_id = p.invoice_json->>'vendor_id'
     WHERE p.organization_id=$1 AND p.status='pending' ${seeAllRaw ? "" : "AND EXISTS (SELECT 1 FROM raw_items r WHERE r.raw_item_id=p.raw_item_id AND r.submitted_by=$2)"}
     ORDER BY p.parsed_invoice_id LIMIT ${PAGE_SIZE} OFFSET ${(parsedPage - 1) * PAGE_SIZE}`,
    seeAllRaw ? [user.organization_id] : [user.organization_id, user.user_id],
  );
  const scope = invoiceScope(user);
  const n = scope.params.length;
  const invoices = await query<Inv>(
    `SELECT i.invoice_id, v.legal_name AS vendor_name, i.vendor_invoice_number, i.invoice_date, i.total, i.currency, i.total_cad, d.name AS department, i.status, i.type, count(*) OVER ()::int AS total_count,
       (SELECT u.full_name FROM approvals a JOIN users u ON u.user_id=a.assigned_user_id WHERE a.invoice_id=i.invoice_id AND a.status='pending' LIMIT 1) AS waiting_on,
       EXISTS (SELECT 1 FROM approvals a LEFT JOIN users au ON au.user_id=a.assigned_user_id WHERE a.invoice_id=i.invoice_id AND a.status='pending'
               AND (a.assigned_user_id=$${n + 1} OR (au.status='on_leave' AND au.delegate_user_id=$${n + 1}))) AS mine
     FROM invoices i LEFT JOIN vendors v ON v.vendor_id=i.vendor_id LEFT JOIN departments d ON d.department_id=i.department_id
     WHERE ${scope.sql} ${status === "all" ? "" : `AND i.status=$${n + 2}`}
     ORDER BY mine DESC, i.invoice_date DESC, i.invoice_id DESC LIMIT ${PAGE_SIZE} OFFSET ${(invPage - 1) * PAGE_SIZE}`,
    status === "all" ? [...scope.params, user.user_id] : [...scope.params, user.user_id, status],
  );

  return (
    <div className="space-y-6">
      <PageTitle sub="Raw items stay as they arrived. Extract turns one into a parsed invoice; approving a parsed invoice adds it to the invoices.">Invoices</PageTitle>

      <Card
        title={
          <span className="flex flex-wrap items-center gap-3">
            1. Raw
            <span className="flex gap-1 normal-case">
              {([[null, "All"], ["email", "Emails"], ["pdf", "Uploads"], ["form", "Forms"]] as const).map(([k, label]) => {
                const q = new URLSearchParams(Object.entries(sp).filter(([key, v]) => typeof v === "string" && key !== "rawKind" && key !== "rawPage") as [string, string][]);
                if (k) q.set("rawKind", k);
                return <Link key={label} href={`?${q}`} scroll={false} className="chip" aria-current={rawKind === k}>{label}</Link>;
              })}
            </span>
          </span>
        }
        actions={
          <>
            {can(user, "raw.poll") && <ActionForm action={pollAction}><button className={btnLight}>Poll AP inbox</button></ActionForm>}
            {can(user, "raw.submit") && <Link href="/invoices/upload" className={btnLight}>Upload PDF</Link>}
            {can(user, "raw.submit") && <Link href="/invoices/form" className={btn}>Fill form</Link>}
          </>
        }
      >
        <Table head={["Raw item", "Kind", "From / file", "Received", "Status", ""]} empty="No raw items yet.">
          {raw.map((r) => (
            <tr key={r.raw_item_id}>
              <Td className="font-mono text-xs">{r.raw_item_id}</Td>
              <Td><Badge>{r.kind}</Badge></Td>
              <Td>
                {r.kind === "email" && <div><span className="font-medium">{r.from_name}</span> — {r.subject}</div>}
                {r.kind === "form" && <div>Form: {r.form_json?.vendor_invoice_number} {r.submitter && <span className="muted">by {r.submitter}</span>}</div>}
                <div className="text-xs muted">
                  {r.files.map((f) => <a key={f.file_name} href={`/api/raw-items/${r.raw_item_id}/file?name=${encodeURIComponent(f.file_name)}`} target="_blank" className="mr-2 link">{f.file_name}</a>)}
                  {r.kind === "email" && r.files.length === 0 && "no attachment"}
                </div>
                {r.no_invoice_reason && <div className="text-xs muted">{r.no_invoice_reason}</div>}
              </Td>
              <Td className="whitespace-nowrap">{date(r.received_at)}</Td>
              <Td><Status value={r.status} /></Td>
              <Td>
                {r.status === "new" && can(user, "raw.extract") && (
                  <ActionForm action={extractAction.bind(null, r.raw_item_id)}><button className={btnLight}>Extract</button></ActionForm>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <Pager param="rawPage" page={rawPage} total={raw[0]?.total_count ?? 0} params={sp} size={RAW_PAGE_SIZE} />
      </Card>

      <Card title={`2. Parsed — pending approval (${parsed[0]?.total_count ?? 0})`}>
        <Table head={["Parsed", "Vendor", "Invoice #", "Date", "Total", "Flags", ""]} empty="Nothing waiting for review.">
          {parsed.map((p) => (
            <tr key={p.parsed_invoice_id}>
              <Td className="font-mono text-xs"><A href={`/invoices/${p.parsed_invoice_id}`}>{p.parsed_invoice_id}</A></Td>
              <Td>{p.vendor_name ?? <span className="text-flag">{p.invoice_json.vendor_name ?? "Unknown"} (not in master)</span>}</Td>
              <Td>{p.invoice_json.vendor_invoice_number}{p.invoice_json.document_type === "credit_note" && <Badge tone="violet">credit note</Badge>}</Td>
              <Td>{date(p.invoice_json.invoice_date)}</Td>
              <Td className="whitespace-nowrap">{money(p.invoice_json.total, p.invoice_json.currency)}</Td>
              <Td className="space-x-1">
                {p.blocking > 0 && <Badge tone="red">{p.blocking} blocking</Badge>}
                {p.warnings > 0 && <Badge tone="gold">{p.warnings} warning{p.warnings > 1 ? "s" : ""}</Badge>}
                {!p.blocking && !p.warnings && <Badge tone="green">clear</Badge>}
              </Td>
              <Td><A href={`/invoices/${p.parsed_invoice_id}`}>Review</A></Td>
            </tr>
          ))}
        </Table>
        <Pager param="parsedPage" page={parsedPage} total={parsed[0]?.total_count ?? 0} params={sp} />
      </Card>

      <Card
        title="3. Invoices"
        actions={
          <div className="flex gap-1 text-xs">
            {STATUSES.map((s) => (
              <Link
                key={s}
                href={`?${new URLSearchParams([...Object.entries(sp).filter(([key, v]) => typeof v === "string" && key !== "status" && key !== "page"), ...(s === "all" ? [] : [["status", s]])] as [string, string][])}`}
                scroll={false}
                className="chip"
                aria-current={s === status}
              >
                {s.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
        }
      >
        <Table head={["Invoice", "Vendor", "Invoice #", "Date", "Total", "Department", "Status", "Waiting on"]} empty="No invoices.">
          {invoices.map((i) => (
            <tr key={i.invoice_id} className={i.mine ? "row-mine" : ""}>
              <Td className="font-mono text-xs"><A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A></Td>
              <Td>{i.vendor_name}</Td>
              <Td>{i.vendor_invoice_number}</Td>
              <Td className="whitespace-nowrap">{date(i.invoice_date)}</Td>
              <Td className="whitespace-nowrap">{money(i.total, i.currency)}</Td>
              <Td>{i.department}</Td>
              <Td><Status value={i.status} /></Td>
              <Td>{i.mine ? <Badge tone="gold">you</Badge> : i.waiting_on}</Td>
            </tr>
          ))}
        </Table>
        <Pager param="page" page={invPage} total={invoices[0]?.total_count ?? 0} params={sp} />
      </Card>
    </div>
  );
}
