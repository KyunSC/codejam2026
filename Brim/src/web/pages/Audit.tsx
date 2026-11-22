import { useSearchParams } from "react-router-dom";
import { can } from "@/lib/authz";
import { API_PAGE_SIZE } from "@/lib/paging";
import type { AuditRow } from "@/services/audit.service";
import { get, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { AuditFilters } from "../components/AuditFilters";
import { DataTable, type Column } from "../components/DataTable";
import { A, Card, NotFound, PageTitle, Pager, Show, btnLight, dateTime, pageParam } from "../components/ui";

type Options = { invoices: string[]; people: { user_id: string; full_name: string }[]; actions: string[] };

// The audit table's columns; their order and visibility come from the user's preferences (TABLES.audit).
const AUDIT_COLUMNS: Column<AuditRow>[] = [
  { id: "id", className: "muted text-xs", render: (e) => e.event_id },
  { id: "when", className: "whitespace-nowrap text-xs", render: (e) => dateTime(e.occurred_at) },
  { id: "who", render: (e) => <>{e.actor ?? "system"} <span className="muted text-xs">{e.actor_role?.replace(/_/g, " ")}</span>{e.on_behalf && <div className="muted text-xs">on behalf of {e.on_behalf}</div>}</> },
  { id: "action", className: "font-mono text-xs", render: (e) => e.action },
  { id: "on", className: "font-mono text-xs", render: (e) => <>{e.entity_type} {e.entity_id}</> },
  { id: "links", className: "space-x-2 text-xs", render: (e) => (<>
    {e.invoice_id && <A href={`/invoices/${e.invoice_id}`}>{e.invoice_id}</A>}
    {e.payment_id && <A href={`/payments/${e.payment_id}`}>{e.payment_id}</A>}
    {e.vendor_id && <A href={`/vendors/${e.vendor_id}`}>{e.vendor_id}</A>}
  </>) },
  { id: "note", className: "max-w-xs truncate text-xs", render: (e) => e.note },
];

export function Audit() {
  const user = useUser();
  const [sp] = useSearchParams();
  const filter = { invoice: sp.get("invoice"), actor: sp.get("actor"), action: sp.get("action") };
  const page = pageParam(sp.get("page"));
  const options = useLoad(() => get<Options>(org(user, "/audit-events/filters")), "");
  const rows = useLoad(() => get<(AuditRow & { total_count: number })[]>(org(user, `/audit-events${qs({ ...filter, page })}`)), `${qs(filter)}:${page}`);
  if (!can(user, "audit.view")) return <NotFound />;
  return (
    <div className="space-y-5">
      <PageTitle sub="Every action, who took it and when. The log cannot be edited or deleted.">Audit</PageTitle>
      <Card title="Events" actions={<a href={org(user, `/audit-events/export${qs(filter)}`)} className={btnLight}>Export CSV</a>}>
        {options.data && <div className="mb-4"><AuditFilters organizationId={user.organization_id!} {...options.data} /></div>}
        <Show load={rows}>
          {(list) => (
            <>
              <DataTable table="audit" rows={list} rowKey={(e) => e.event_id} columns={AUDIT_COLUMNS} empty="No events." />
              <Pager param="page" page={page} total={list[0]?.total_count ?? 0} size={API_PAGE_SIZE} />
            </>
          )}
        </Show>
      </Card>
    </div>
  );
}
