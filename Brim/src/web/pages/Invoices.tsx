import { Link, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import type { InvoiceRow, ParsedRow, RawItemRow } from "@/services/read.service";
import { get, post, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { ApiForm } from "../components/ApiForm";
import { DataTable, type Column } from "../components/DataTable";
import { A, Badge, Card, PageTitle, Pager, Show, Status, Table, Td, btn, btnLight, date, PAGE_SIZE, pageParam, withParams } from "../components/ui";

const STATUSES = ["all", "pending_approval", "approved", "scheduled", "paid", "rejected"];

// The invoices table's columns (ids and labels in TABLES.invoices, src/lib/preferences.ts).
const INVOICE_COLUMNS: Column<InvoiceRow>[] = [
  { id: "id", className: "font-mono text-xs", render: (i) => <A href={`/invoices/${i.invoice_id}`}>{i.invoice_id}</A> },
  { id: "vendor", render: (i) => i.vendor_name },
  { id: "number", render: (i) => i.vendor_invoice_number },
  { id: "date", className: "whitespace-nowrap", render: (i) => date(i.invoice_date) },
  { id: "total", className: "whitespace-nowrap", render: (i) => money(i.total, i.currency) },
  { id: "department", render: (i) => i.department },
  { id: "status", render: (i) => <Status value={i.status} /> },
  { id: "waiting_on", render: (i) => (i.mine ? <Badge tone="gold">you</Badge> : i.waiting_on) },
];
const KINDS = ["email", "pdf", "form"];

export function Invoices() {
  const user = useUser();
  const [sp] = useSearchParams();
  const status = STATUSES.includes(sp.get("status") ?? "") ? sp.get("status")! : "all";
  const rawKind = KINDS.includes(sp.get("rawKind") ?? "") ? sp.get("rawKind") : null;
  const rawPage = pageParam(sp.get("rawPage"));
  const parsedPage = pageParam(sp.get("parsedPage"));
  const invPage = pageParam(sp.get("page"));

  const raw = useLoad(() => get<RawItemRow[]>(org(user, `/raw-items${qs({ kind: rawKind, page: rawPage, size: PAGE_SIZE })}`)), `${rawKind}:${rawPage}`);
  const parsed = useLoad(() => get<ParsedRow[]>(org(user, `/parsed-invoices${qs({ page: parsedPage, size: PAGE_SIZE })}`)), `${parsedPage}`);
  const invoices = useLoad(
    () => get<InvoiceRow[]>(org(user, `/invoices${qs({ status: status === "all" ? null : status, page: invPage, size: PAGE_SIZE })}`)),
    `${status}:${invPage}`,
  );
  const reloadAll = () => [raw, parsed, invoices].forEach((l) => l.reload());

  const poll = async () => {
    const r = await post<{ added: number; skipped: number }>(org(user, "/raw-items/poll"));
    raw.reload();
    return `${r.added} new email${r.added === 1 ? "" : "s"} (${r.skipped} already in).`;
  };
  const extract = (id: string) => async () => {
    await post(org(user, `/raw-items/${id}/extract`));
    reloadAll();
    return "Extracted.";
  };

  // The raw items table's columns (ids and labels in TABLES.raw, src/lib/preferences.ts).
  const rawColumns: Column<RawItemRow>[] = [
    { id: "id", className: "font-mono text-xs", render: (r) => r.raw_item_id },
    { id: "kind", render: (r) => <Badge>{r.kind}</Badge> },
    {
      id: "from",
      render: (r) => (
        <>
          {r.kind === "email" && <div><span className="font-medium">{r.from_name}</span> — {r.subject}</div>}
          {r.kind === "form" && <div>Form: {r.form_json?.vendor_invoice_number} {r.submitter && <span className="muted">by {r.submitter}</span>}</div>}
          <div className="text-xs muted">
            {r.files.map((f) => <a key={f.file_name} href={org(user, `/raw-items/${r.raw_item_id}/files/${encodeURIComponent(f.file_name)}`)} target="_blank" rel="noreferrer" className="mr-2 link">{f.file_name}</a>)}
            {r.kind === "email" && r.files.length === 0 && "no attachment"}
          </div>
          {r.no_invoice_reason && <div className="text-xs muted">{r.no_invoice_reason}</div>}
        </>
      ),
    },
    { id: "received", className: "whitespace-nowrap", render: (r) => date(r.received_at) },
    { id: "status", render: (r) => <Status value={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageTitle sub="Raw items stay as they arrived. Extract turns one into a parsed invoice; approving a parsed invoice adds it to the invoices.">Invoices</PageTitle>

      <Card
        title={
          <span className="flex flex-wrap items-center gap-3">
            1. Raw
            <span className="flex gap-1 normal-case">
              {([[null, "All"], ["email", "Emails"], ["pdf", "Uploads"], ["form", "Forms"]] as const).map(([k, label]) => (
                <Link key={label} to={withParams(sp, { rawKind: k, rawPage: null })} className="chip" aria-current={rawKind === k}>{label}</Link>
              ))}
            </span>
          </span>
        }
        actions={
          <>
            {can(user, "raw.poll") && <ApiForm submit={poll}><button className={btnLight}>Poll AP inbox</button></ApiForm>}
            {can(user, "raw.submit") && <Link to="/invoices/upload" className={btnLight}>Upload PDF</Link>}
            {can(user, "raw.submit") && <Link to="/invoices/form" className={btn}>Fill form</Link>}
          </>
        }
      >
        <Show load={raw}>
          {(rows) => (
            <>
              <DataTable
                table="raw"
                rows={rows}
                rowKey={(r) => r.raw_item_id}
                columns={rawColumns}
                trailing={(r) => r.status === "new" && can(user, "raw.extract") && (
                  <ApiForm submit={extract(r.raw_item_id)}><button className={btnLight}>Extract</button></ApiForm>
                )}
                empty="No raw items yet."
              />
              <Pager param="rawPage" page={rawPage} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>

      <Card title={`2. Parsed — pending approval (${parsed.data?.[0]?.total_count ?? 0})`}>
        <Show load={parsed}>
          {(rows) => (
            <>
              <Table head={["Parsed", "Vendor", "Invoice #", "Date", "Total", "Flags", ""]} empty="Nothing waiting for review.">
                {rows.map((p) => (
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
              <Pager param="parsedPage" page={parsedPage} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>

      <Card
        title="3. Invoices"
        actions={
          <div className="flex gap-1 text-xs">
            {STATUSES.map((s) => (
              <Link key={s} to={withParams(sp, { status: s === "all" ? null : s, page: null })} className="chip" aria-current={s === status}>
                {s.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
        }
      >
        <Show load={invoices}>
          {(rows) => (
            <>
              <DataTable table="invoices" rows={rows} rowKey={(i) => i.invoice_id} rowClassName={(i) => (i.mine ? "row-mine" : "")} columns={INVOICE_COLUMNS} empty="No invoices." />
              <Pager param="page" page={invPage} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>
    </div>
  );
}
