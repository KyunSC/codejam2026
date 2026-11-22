import { useSearchParams } from "react-router-dom";
import { actionName, entityName } from "@/lib/auditActions";
import { can } from "@/lib/authz";
import { API_PAGE_SIZE } from "@/lib/paging";
import type { AuditRow } from "@/services/audit.service";
import { get, qs, useLoad } from "../api";
import { org, useUser } from "../session";
import { AuditFilters } from "../components/AuditFilters";
import { A, Badge, Card, NotFound, Pager, Show, Table, Td, btnLight, dateTime, pageParam } from "../components/ui";
import { VendorLink } from "../components/VendorLink";

type Options = { invoices: string[]; people: { user_id: string; full_name: string }[]; actions: string[] };

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
      <Card title="Events" actions={<a href={org(user, `/audit-events/export${qs(filter)}`)} className={btnLight}>Export CSV</a>}>
        {options.data && <div className="mb-4"><AuditFilters organizationId={user.organization_id!} {...options.data} /></div>}
        <Show load={rows}>
          {(list) => (
            <>
              <Table head={["#", "When", "Who", "Action", "On", "Links", "Note"]} empty="No events.">
                {list.map((e) => (
                  <tr key={e.event_id}>
                    <Td className="muted text-xs">{e.event_id}</Td>
                    <Td className="whitespace-nowrap text-xs">{dateTime(e.occurred_at)}</Td>
                    <Td>{e.actor ?? "system"} <span className="muted text-xs">{e.actor_role?.replace(/_/g, " ")}</span>{e.on_behalf && <div className="muted text-xs">on behalf of {e.on_behalf}</div>}</Td>
                    <Td className="text-xs">{actionName(e.action)}{e.channel === "agent" && <Badge tone="purple">agent</Badge>}</Td>
                    <Td className="text-xs">{entityName(e.entity_type)} <span className="font-mono">{e.entity_id}</span></Td>
                    <Td className="space-x-2 text-xs">
                      {e.invoice_id && <A href={`/invoices/${e.invoice_id}`}>{e.invoice_id}</A>}
                      {e.payment_id && <A href={`/payments/${e.payment_id}`}>{e.payment_id}</A>}
                      {e.vendor_id && <VendorLink id={e.vendor_id}>{e.vendor_id}</VendorLink>}
                    </Td>
                    <Td className="max-w-xs truncate text-xs">{e.note}</Td>
                  </tr>
                ))}
              </Table>
              <Pager param="page" page={page} total={list[0]?.total_count ?? 0} size={API_PAGE_SIZE} />
            </>
          )}
        </Show>
      </Card>
    </div>
  );
}
