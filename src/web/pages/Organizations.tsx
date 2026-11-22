import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Organization as OrganizationRecord } from "@/services/organization.service";
import { get, patch, post, useLoad } from "../api";
import { ApiForm, str } from "../components/ApiForm";
import { A, Card, Field, PageTitle, Show, Table, Td, btn, btnLight, date, input } from "../components/ui";

export function Organizations() {
  const load = useLoad(() => get<(OrganizationRecord & { users: number })[]>("/api/organizations"), "");
  const navigate = useNavigate();
  // "+ Add organization" opens an empty row at the top of the list
  const [adding, setAdding] = useState(false);
  const create = async (fd: FormData) => {
    const r = await post<{ id: string }>("/api/organizations", { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number") ?? undefined });
    navigate(`/organizations/${r.id}`);
  };
  return (
    <div className="space-y-5">
      <PageTitle>Organizations</PageTitle>
      <Card title="All organizations" actions={!adding && <button className={btnLight} onClick={() => setAdding(true)}>+ Add organization</button>}>
        <Show load={load}>
          {(orgs) => (
            <Table head={["Organization", "GST/HST", "Users", "Created"]} empty="No organizations yet.">
              {adding && (
                <tr className="bg-surface-2">
                  <Td><input form="new-organization" name="legal_name" placeholder="Legal name" className={input} required aria-label="Legal name" /></Td>
                  <Td><input form="new-organization" name="gst_hst_number" placeholder="GST/HST number" className={input} aria-label="GST/HST number" /></Td>
                  <Td />
                  <Td>
                    <ApiForm id="new-organization" submit={create} className="flex flex-wrap items-start gap-2">
                      <button className={btn}>Add</button>
                      <button type="button" className={btnLight} onClick={() => setAdding(false)}>Cancel</button>
                    </ApiForm>
                  </Td>
                </tr>
              )}
              {orgs.map((o) => (
                <tr key={o.organization_id}>
                  <Td><A href={`/organizations/${o.organization_id}`}>{o.legal_name}</A> <span className="text-xs muted">{o.organization_id}</span></Td>
                  <Td className="font-mono text-xs">{o.gst_hst_number}</Td>
                  <Td>{o.users}</Td>
                  <Td>{date(o.created_at)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Show>
      </Card>
    </div>
  );
}

export function Organization() {
  const { id = "" } = useParams();
  const base = `/api/organizations/${id}`;
  const load = useLoad(() => get<OrganizationRecord>(base), id);
  const save = async (fd: FormData) => {
    await patch(base, { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number"), base_currency: str(fd, "base_currency") ?? "CAD" });
    load.reload();
    return "Saved.";
  };
  return (
    <Show load={load}>
      {(org) => (
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
        </div>
      )}
    </Show>
  );
}
