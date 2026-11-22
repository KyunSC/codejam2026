import { useNavigate, useParams } from "react-router-dom";
import type { User } from "@/lib/types";
import type { Organization as OrganizationRecord } from "@/services/organization.service";
import { get, patch, post, useLoad } from "../api";
import { ApiForm, str } from "../components/ApiForm";
import { A, Card, Field, PageTitle, Show, Status, Table, Td, btn, date, input } from "../components/ui";

export function Organizations() {
  const navigate = useNavigate();
  const load = useLoad(() => get<(OrganizationRecord & { users: number; invoices: number })[]>("/api/organizations"), "");
  const create = async (fd: FormData) => {
    const r = await post<{ id: string }>("/api/organizations", { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number") ?? undefined });
    navigate(`/organizations/${r.id}`);
  };
  return (
    <div className="space-y-5">
      <PageTitle>Organizations</PageTitle>
      <Card title="All organizations">
        <Show load={load}>
          {(orgs) => (
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
          )}
        </Show>
      </Card>
      <Card title="New organization">
        <ApiForm submit={create} className="flex items-end gap-3">
          <Field label="Legal name"><input name="legal_name" className={input} required /></Field>
          <Field label="GST/HST number"><input name="gst_hst_number" className={input} /></Field>
          <button className={btn}>Create</button>
        </ApiForm>
      </Card>
    </div>
  );
}

export function Organization() {
  const { id = "" } = useParams();
  const base = `/api/organizations/${id}`;
  const load = useLoad(async () => {
    const [org, depts, users] = await Promise.all([
      get<OrganizationRecord>(base),
      get<{ department_id: string; name: string; cost_centre: string; manager: string | null }[]>(`${base}/departments`),
      get<User[]>(`${base}/users`),
    ]);
    return { org, depts, users };
  }, id);
  const save = async (fd: FormData) => {
    await patch(base, { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number"), base_currency: str(fd, "base_currency") ?? "CAD" });
    load.reload();
    return "Saved.";
  };
  return (
    <Show load={load}>
      {({ org, depts, users }) => (
        <div className="space-y-5">
          <PageTitle>{org.legal_name}</PageTitle>
          <Card title="Settings">
            <ApiForm submit={save} className="grid grid-cols-3 items-end gap-3">
              <Field label="Legal name"><input name="legal_name" defaultValue={org.legal_name} className={input} required /></Field>
              <Field label="GST/HST number"><input name="gst_hst_number" defaultValue={org.gst_hst_number ?? ""} className={input} /></Field>
              <Field label="Base currency"><select name="base_currency" defaultValue={org.base_currency} className={input}><option>CAD</option><option>USD</option></select></Field>
              <div><button className={btn}>Save</button></div>
            </ApiForm>
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
      )}
    </Show>
  );
}
