import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, PageTitle, Status, Table, Td, btn, input } from "@/components/ui";
import { updateOrgAction } from "../../../actions";

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await one<{ organization_id: string; legal_name: string; gst_hst_number: string | null; base_currency: string }>("SELECT * FROM organizations WHERE organization_id=$1", [id]);
  if (!org) notFound();
  const depts = await query<{ department_id: string; name: string; cost_centre: string; manager: string | null }>(
    "SELECT d.*, u.full_name manager FROM departments d LEFT JOIN users u ON u.user_id=d.manager_user_id WHERE d.organization_id=$1 ORDER BY d.name",
    [id],
  );
  const users = await query<{ user_id: string; full_name: string; role: string; title: string; status: string }>(
    "SELECT user_id, full_name, role, title, status FROM users WHERE organization_id=$1 ORDER BY role, full_name",
    [id],
  );
  return (
    <div className="space-y-5">
      <PageTitle>{org.legal_name}</PageTitle>
      <Card title="Settings">
        <ActionForm action={updateOrgAction.bind(null, id)} className="grid grid-cols-3 items-end gap-3">
          <Field label="Legal name"><input name="legal_name" defaultValue={org.legal_name} className={input} required /></Field>
          <Field label="GST/HST number"><input name="gst_hst_number" defaultValue={org.gst_hst_number ?? ""} className={input} /></Field>
          <Field label="Base currency"><select name="base_currency" defaultValue={org.base_currency} className={input}><option>CAD</option><option>USD</option></select></Field>
          <div><button className={btn}>Save</button></div>
        </ActionForm>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Departments (${depts.length})`}>
          <Table head={["Department", "Cost centre", "Manager"]}>
            {depts.map((d) => <tr key={d.department_id}><Td>{d.name}</Td><Td>{d.cost_centre}</Td><Td>{d.manager}</Td></tr>)}
          </Table>
        </Card>
        <Card title={`Users (${users.length})`}>
          <Table head={["User", "Title", "Role", "Status"]}>
            {users.map((u) => <tr key={u.user_id}><Td>{u.full_name}</Td><Td>{u.title}</Td><Td>{u.role.replace("_", " ")}</Td><Td><Status value={u.status} /></Td></tr>)}
          </Table>
        </Card>
      </div>
    </div>
  );
}
