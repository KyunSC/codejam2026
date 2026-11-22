import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { A, Card, Field, PageTitle, Table, Td, btn, date, input } from "@/components/ui";
import { createOrgAction } from "../../actions";

export default async function OrganizationsPage() {
  const orgs = await query<{ organization_id: string; legal_name: string; gst_hst_number: string | null; created_at: string; users: number; invoices: number }>(
    `SELECT o.*, (SELECT count(*)::int FROM users u WHERE u.organization_id=o.organization_id) users,
       (SELECT count(*)::int FROM invoices i WHERE i.organization_id=o.organization_id) invoices FROM organizations o ORDER BY o.legal_name`,
  );
  return (
    <div className="space-y-5">
      <PageTitle>Organizations</PageTitle>
      <Card title="All organizations">
        <Table head={["Organization", "GST/HST", "Users", "Invoices", "Created"]} empty="No organizations yet.">
          {orgs.map((o) => (
            <tr key={o.organization_id}>
              <Td><A href={`/organizations/${o.organization_id}`}>{o.legal_name}</A> <span className="text-xs muted">{o.organization_id}</span></Td>
              <Td className="font-mono text-xs">{o.gst_hst_number}</Td>
              <Td>{o.users}</Td>
              <Td>{o.invoices}</Td>
              <Td>{date(o.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="New organization">
        <ActionForm action={createOrgAction} className="flex items-end gap-3">
          <Field label="Legal name"><input name="legal_name" className={input} required /></Field>
          <Field label="GST/HST number"><input name="gst_hst_number" className={input} /></Field>
          <button className={btn}>Create</button>
        </ActionForm>
      </Card>
    </div>
  );
}
