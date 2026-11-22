import { useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { money } from "@/lib/format";
import { HANDLING_OUTCOMES } from "@/lib/handling";
import type { InvoiceRow, ParsedRow, RawItemRow } from "@/services/read.service";
import { get, post, qs, useLoad } from "../api";
import { useListFilter } from "../useListFilter";
import { org, useUser } from "../session";
import { ApiForm } from "../components/ApiForm";
import { A, Badge, Card, PageTitle, Pager, Show, Status, Table, Td, btn, btnLight, date, PAGE_SIZE, pageParam, withParams } from "../components/ui";

const STATUSES = ["all", "pending_approval", "approved", "scheduled", "paid", "rejected"];
const KINDS = ["email", "pdf", "form"];
// The raw list's views. "todo" (what still needs someone) is the clerk's default; "open" is everything not settled
// (to do + waiting on sender); "all" is the archive.
const RAW_VIEWS = ["open", "todo", "needs", "waiting", "handled", "all"];
const FLAG_FILTERS = [[null, "All"], ["blocking", "Blocking"], ["warning", "Warning"], ["clear", "Clear"]] as const;

// The typed search box in a list's header; it filters as you type.
function SearchBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return <input className="input mr-1 w-60 max-w-full" type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />;
}
const dim = (busy: boolean) => (busy ? "opacity-60 transition-opacity" : "transition-opacity");

export function Invoices() {
  const user = useUser();
  const { sp, search, draft, setDraft, term } = useListFilter();
  const parsedFilter = useListFilter("parsedQ", "parsedPage");
  // the raw list's own search (rawQ, rawFrom, rawTo) sets the URL directly
  const [, setSp] = useSearchParams();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  // AP sees the whole pipeline; someone who only submits sees their submissions and what happened to them
  const ap = can(user, "raw.extract") || can(user, "parsed.review");
  const status = STATUSES.includes(sp.get("status") ?? "") ? sp.get("status")! : "all";
  const rawKind = KINDS.includes(sp.get("rawKind") ?? "") ? sp.get("rawKind") : null;
  // the clerk deals with raw items and sees their workload; a submitter sees all of their own submissions
  const handles = can(user, "parsed.review");
  const rawView = RAW_VIEWS.includes(sp.get("raw") ?? "") ? sp.get("raw")! : handles ? "todo" : "all";
  const attention = handles && rawView !== "all" ? rawView : null;
  const rawQ = sp.get("rawQ") ?? "";
  const rawFrom = sp.get("rawFrom") ?? "";
  const rawTo = sp.get("rawTo") ?? "";
  const rawSearching = !!(rawQ || rawFrom || rawTo);
  const rawPage = pageParam(sp.get("rawPage"));
  const parsedPage = pageParam(sp.get("parsedPage"));
  const parsedFlags = FLAG_FILTERS.find(([k]) => k && k === sp.get("parsedFlags"))?.[0] ?? null;
  const invPage = pageParam(sp.get("page"));

  const raw = useLoad(
    () => get<RawItemRow[]>(org(user, `/raw-items${qs({ kind: rawKind, attention, q: rawQ || null, from: rawFrom || null, to: rawTo || null, page: rawPage, size: PAGE_SIZE })}`)),
    `${rawKind}:${attention}:${rawQ}:${rawFrom}:${rawTo}:${rawPage}`,
  );
  const counts = useLoad(
    () => (handles
      ? get<{ reading: number; needs: number; waiting: number; todo: number; open: number }>(org(user, "/raw-items/attention"))
      : Promise.resolve({ reading: 0, needs: 0, waiting: 0, todo: 0, open: 0 })),
    `${attention}:${rawPage}:${raw.data?.[0]?.raw_item_id ?? ""}`,
  );
  const searchRaw = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams(sp);
    for (const k of ["rawQ", "rawFrom", "rawTo"]) {
      const v = String(fd.get(k) ?? "").trim();
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("rawPage");
    // searching looks through the archive, not just today's to-do list
    if (handles && (next.get("rawQ") || next.get("rawFrom") || next.get("rawTo")) && rawView === "todo") next.set("raw", "all");
    setSp(next);
  };
  const parsedPath = org(user, `/parsed-invoices${qs({ q: parsedFilter.search || null, flags: parsedFlags, page: parsedPage, size: PAGE_SIZE })}`);
  const parsed = useLoad(() => get<ParsedRow[]>(parsedPath), parsedPath);
  const parsedFiltering = !!(parsedFilter.search || parsedFlags);
  const parsedBusy = parsedFilter.term !== parsedFilter.search || !!parsed.stale;
  // the clerk runs the checks again on a parsed invoice from its row too
  const review = can(user, "parsed.review");
  const runChecks = (id: string) => async () => {
    await post(org(user, `/parsed-invoices/${id}/checks`));
    parsed.reload();
  };
  // while something is being read, look again every few seconds
  const readingNow = (raw.data ?? []).some((r) => r.status === "new");
  useEffect(() => {
    if (!readingNow) return;
    const t = setInterval(() => {
      raw.reload();
      parsed.reload();
    }, 3000);
    return () => clearInterval(t);
    // reload functions change every render; readingNow is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingNow]);

  const poll = async () => {
    const r = await post<{ added: number; skipped: number; reading: number }>(org(user, "/raw-items/poll"));
    raw.reload();
    return `${r.added} new email${r.added === 1 ? "" : "s"}; ${r.reading} being read.`;
  };

  return (
    <div className="space-y-6">
      <PageTitle sub={ap
        ? "Raw items stay as they arrived. Uploads and emails are read automatically into parsed invoices, and a form is one already; approving a parsed invoice adds it to the invoices."
        : "Submit an invoice by uploading it or filling the form. Accounts payable checks it, then it goes to its approvers."}>Invoices</PageTitle>
      {notice && <p className="form-ok">{notice}</p>}

      <Card
        id="raw"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {ap ? "1. Raw" : "Your submissions"}
            {ap && <span className="flex gap-1 normal-case">
              {([[null, "All"], ["email", "Emails"], ["pdf", "Uploads"], ["form", "Forms"]] as const).map(([k, label]) => (
                <Link key={label} to={withParams(sp, { rawKind: k, rawPage: null })} className="chip" aria-current={rawKind === k}>{label}</Link>
              ))}
            </span>}
            {handles && <span className="flex gap-1 normal-case">
              {([
                ["open", `All (${counts.data?.open ?? 0})`, "Everything still to address: to do, needing attention and waiting on the sender"],
                ["todo", `To do (${counts.data?.todo ?? 0})`, "Being read, or with no invoice and not dealt with yet"],
                ["needs", `Needs attention (${counts.data?.needs ?? 0})`, "No invoice in it or not readable, and nobody has dealt with it"],
                ["waiting", `Waiting on sender (${counts.data?.waiting ?? 0})`, "You asked the sender to send it again"],
                ["handled", "Handled", "Fully dealt with: reviewed, answered, forwarded or dismissed. A request to the sender stays under Waiting on sender"],
                ["all", "Archive", "Everything ever received"],
              ] as const).map(([k, label, hint]) => (
                <Link
                  key={k}
                  to={withParams(sp, { raw: k === "todo" ? null : k, rawPage: null })}
                  className={`chip ${k === "needs" && (counts.data?.needs ?? 0) > 0 ? "chip--red" : ""}`}
                  aria-current={rawView === k}
                  title={hint}
                >
                  {label}
                </Link>
              ))}
            </span>}
          </span>
        }
        actions={
          <>
            {can(user, "raw.poll") && <ApiForm inline submit={poll}><button className={btnLight}>Poll AP inbox</button></ApiForm>}
            {can(user, "raw.submit") && <Link to="/invoices/upload" className={btnLight}>Upload PDF</Link>}
            {can(user, "raw.submit") && <Link to="/invoices/form" className={btn}>Fill form</Link>}
          </>
        }
      >
        {ap && (
          <form onSubmit={searchRaw} className="mb-4 flex flex-wrap items-end gap-2" role="search" key={`${rawQ}:${rawFrom}:${rawTo}`}>
            <label className="field min-w-[220px] flex-1">
              <span>Search</span>
              <input className="input" type="search" name="rawQ" defaultValue={rawQ} placeholder="Raw id, sender, subject or file name" />
            </label>
            <label className="field">
              <span>Received from</span>
              <input className="input" type="date" name="rawFrom" defaultValue={rawFrom} />
            </label>
            <label className="field">
              <span>to</span>
              <input className="input" type="date" name="rawTo" defaultValue={rawTo} />
            </label>
            <button className={btnLight}>Search</button>
            {rawSearching && (
              <Link to={withParams(sp, { rawQ: null, rawFrom: null, rawTo: null, rawPage: null })} className={btnLight}>Clear</Link>
            )}
          </form>
        )}
        <Show load={raw}>
          {(rows) => (
            <>
              <Table
                head={[ap ? "Raw item" : "Submission", "Kind", "From / file", "Received", "Status"]}
                empty={
                  !ap ? "You have not submitted anything yet."
                    : rawSearching ? "Nothing received matches this search."
                    : rawView === "open" ? "Nothing to address: every email and upload has been read or dealt with. See Archive for everything received."
                    : rawView === "todo" ? "Nothing to do: every email and upload has been read or dealt with. See Archive for everything received."
                    : rawView === "needs" ? "Nothing needs attention."
                    : rawView === "waiting" ? "Nothing is waiting on a sender."
                    : rawView === "handled" ? "Nothing handled yet."
                    : "No raw items yet."
                }
              >
                {rows.map((r) => (
                  <tr key={r.raw_item_id}>
                    <Td className="font-mono text-xs"><A href={`/invoices/${r.raw_item_id}`}>{r.raw_item_id}</A></Td>
                    <Td><Badge>{r.kind}</Badge></Td>
                    <Td>
                      {r.kind === "email" && <div><span className="font-medium">{r.from_name}</span> — {r.subject}</div>}
                      {r.kind === "pdf" && r.submitter && <div className="muted">uploaded by {r.submitter}</div>}
                      {r.kind === "form" && <div>Form: {r.form_json?.vendor_invoice_number} {r.submitter && <span className="muted">by {r.submitter}</span>}</div>}
                      <div className="text-xs muted">
                        {r.files.map((f) => <a key={f.file_name} href={org(user, `/raw-items/${r.raw_item_id}/files/${encodeURIComponent(f.file_name)}`)} target="_blank" rel="noreferrer" className="mr-2 link">{f.file_name}</a>)}
                        {r.kind === "email" && r.files.length === 0 && "no attachment"}
                      </div>
                      {r.no_invoice_reason && <div className="text-xs muted">{r.no_invoice_reason}</div>}
                      {r.handling_outcome && (
                        <div className="text-xs">
                          <span className="font-medium">{HANDLING_OUTCOMES[r.handling_outcome]}</span>
                          <span className="muted"> by {r.handled_by_name}, {date(r.handled_at)}: {r.handling_note}</span>
                        </div>
                      )}
                      {r.status === "failed" && r.failure_reason && <div className="text-xs text-flag">{r.failure_reason}{ap && " It is tried again at the next poll."}</div>}
                    </Td>
                    <Td className="whitespace-nowrap">{date(r.received_at)}</Td>
                    <Td className="space-y-1">
                      {r.status === "new" ? <Badge tone="blue">reading</Badge> : r.status === "failed" ? <Badge tone="red">not read</Badge> : r.status === "extracted" ? <Badge tone="green">{r.kind === "form" ? "submitted" : "read"}</Badge> : <Status value={r.status} />}
                      {handles && (r.status === "no_invoice" || r.status === "failed") && (
                        <div>
                          {!r.handling_outcome ? <Badge tone="red">needs attention</Badge>
                            : r.handling_outcome === "requested" ? <Badge tone="gold">waiting on sender</Badge>
                            : <Badge tone="green">handled</Badge>}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              <Pager param="rawPage" page={rawPage} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
      </Card>

      <Card
        id="parsed"
        title={`${ap ? "2. Parsed — pending approval" : "Confirm data"}${parsedFiltering ? "" : ` (${parsed.data?.[0]?.total_count ?? 0})`}`}
        actions={
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <SearchBox label="Filter parsed invoices" placeholder="Parsed ID, vendor, or invoice #" value={parsedFilter.draft} onChange={parsedFilter.setDraft} />
            {FLAG_FILTERS.map(([k, label]) => (
              <Link key={label} to={withParams(sp, { parsedFlags: k, parsedQ: parsedFilter.term || null, parsedPage: null })} className="chip" aria-current={parsedFlags === k}>{label}</Link>
            ))}
          </div>
        }
      >
        <div aria-busy={parsedBusy} className={dim(parsedBusy)}>
        <Show load={parsed}>
          {(rows) => (
            <>
              <Table head={[ap ? "Parsed" : "Reference", "Vendor", "Invoice #", "Date", "Total", "Flags", ...(review ? [""] : [])]} empty={parsedFiltering ? "No parsed invoices match your filter." : "Nothing waiting for review."}>
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
                    {review && (
                      <Td className="text-right">
                        <ApiForm inline submit={runChecks(p.parsed_invoice_id)}><button className={btnLight}>Run checks again</button></ApiForm>
                      </Td>
                    )}
                  </tr>
                ))}
              </Table>
              <Pager param="parsedPage" page={parsedPage} total={rows[0]?.total_count ?? 0} />
            </>
          )}
        </Show>
        </div>
      </Card>

      <Card
        id="invoices"
        title={ap ? "3. Invoices" : "Invoices"}
        actions={
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <SearchBox label="Filter invoices" placeholder="Invoice ID, number, or vendor" value={draft} onChange={setDraft} />
            {STATUSES.map((s) => (
              <Link key={s} to={withParams(sp, { status: s === "all" ? null : s, q: term || null, page: null })} className="chip" aria-current={s === status}>
                {s.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
        }
      >
        <InvoiceResults search={search} status={status} page={invPage} filtering={term !== search} />
      </Card>
    </div>
  );
}

// The rows stay on screen, dimmed, while a typed filter waits to apply or the next page loads.
function InvoiceResults({ search, status, page, filtering }: { search: string; status: string; page: number; filtering: boolean }) {
  const user = useUser();
  const path = org(user, `/invoices${qs({ q: search, status: status === "all" ? null : status, page, size: PAGE_SIZE })}`);
  const invoices = useLoad(() => get<InvoiceRow[]>(path), path);
  const busy = filtering || !!invoices.stale;
  return (
    <div aria-busy={busy} className={dim(busy)}>
    <Show load={invoices}>
      {(rows) => (
        <>
          <Table head={["Invoice", "Vendor", "Invoice #", "Date", "Total", "Department", "Status", "Waiting on"]} empty={search ? "No invoices match your filter." : "No invoices."}>
            {rows.map((i) => (
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
          <Pager param="page" page={page} total={rows[0]?.total_count ?? 0} />
        </>
      )}
    </Show>
    </div>
  );
}
