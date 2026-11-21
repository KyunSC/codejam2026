import { canManageUsers, canViewAudit, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { handle, json, readJson } from "@/lib/http";
import { createUser, listUsers } from "@/lib/users/service";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/orgs/{slug}/users?q=&role=&status=&departmentId=: the organization's users. */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, (r) => canManageUsers(r) || canViewAudit(r), "see the user list");
    const q = new URL(request.url).searchParams;
    return json(
      await listUsers(caller.org.id, {
        q: q.get("q") ?? undefined,
        role: q.get("role") ?? undefined,
        status: q.get("status") ?? undefined,
        departmentId: q.get("departmentId") ?? undefined,
      }),
    );
  });
}

/**
 * POST /api/orgs/{slug}/users: add a user. Controller/admin only.
 * Body: { fullName, email, role, password?, externalId?, title?, departmentId?, approvalLimitCad?,
 *         workProvince?, status?, statusSince?, hireDate?, managerId?, delegateId? }
 */
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, canManageUsers, "add users");
    return json(await createUser(caller.org.id, caller.actor, await readJson(request)), 201);
  });
}
