import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { query } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Card, Table, Td, btnLight, input, dateTime } from "@/components/ui";
import { savePolicyAction } from "../../../actions";

// Roles a step can be given to; the other step values (manager, delegate, not approver, hold) are fixed by their rule.
const APPROVER_ROLES = ["dept_manager", "finance_manager", "controller", "cfo"];
const RELEASE_ROLES = ["finance_manager", "controller_admin"];
const label = (s: string | null) => (s ?? "").replace(/_/g, " ");

export default async function PoliciesSettings() {
  const user = await requireUser();
  if (!can(user, "policies.manage")) notFound();
  const rows = await query<{ rule_id: string; rule_type: string; trigger_type: string; trigger_value: number | null; step_role: string | null; is_active: boolean; updated_at: string; updater: string | null }>(
    "SELECT p.*, u.full_name updater FROM approval_policies p LEFT JOIN users u ON u.user_id=p.updated_by WHERE p.organization_id=$1 ORDER BY rule_id",
    [user.organization_id],
  );
  return (
    <Card title="Approval and payment policies">
      <Table head={["Rule", "Type", "Amount (CAD)", "Who", "Active", "Last change", ""]}>
        {rows.map((p) => {
          const form = `policy-${p.rule_id}`;
          const roles = p.rule_type === "payment_release" ? RELEASE_ROLES : APPROVER_ROLES;
          return (
            <tr key={p.rule_id}>
              <Td className="font-mono text-xs align-middle">{p.rule_id}</Td>
              <Td className="align-middle">{label(p.rule_type)}</Td>
              <Td className="align-middle">
                {p.trigger_value == null ? <span className="muted">—</span> : <input form={form} name="trigger_value" type="number" defaultValue={p.trigger_value} className={`${input} w-28`} />}
              </Td>
              <Td className="align-middle">
                {p.step_role && roles.includes(p.step_role) ? (
                  <select form={form} name="step_role" defaultValue={p.step_role} className={`${input} w-40`}>
                    {roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                  </select>
                ) : (
                  <>
                    <span>{label(p.step_role)}</span>
                    <input form={form} type="hidden" name="step_role" value={p.step_role ?? ""} />
                  </>
                )}
              </Td>
              <Td className="align-middle"><input form={form} type="checkbox" name="is_active" defaultChecked={p.is_active} className="size-4" /></Td>
              <Td className="muted text-xs align-middle">{p.updater ? `${p.updater}, ${dateTime(p.updated_at)}` : "—"}</Td>
              <Td className="align-middle">
                <ActionForm id={form} action={savePolicyAction.bind(null, p.rule_id)}>
                  <button className={btnLight}>Save</button>
                </ActionForm>
              </Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}
