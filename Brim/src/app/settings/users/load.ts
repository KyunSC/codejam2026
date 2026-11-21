import { ROLE_LABEL } from "@/lib/auth/permissions";
import { listDepartments } from "@/lib/departments";
import { listUsers } from "@/lib/users/service";

/** The choices the user form needs: everyone (for manager and delegate) and the departments by name. */
export async function userFormChoices(orgId: string) {
  const users = await listUsers(orgId);
  return {
    people: users.map((u) => ({ id: u.id, label: `${u.fullName} (${ROLE_LABEL[u.role]})` })),
    departments: await listDepartments(orgId, users.map((u) => u.departmentId)),
  };
}
