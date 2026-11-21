import { canManageUsers, canViewAudit, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { handle, json, readJson } from "@/lib/http";
import { deleteUser, getUser, publicUser, updateUser } from "@/lib/users/service";

/** userId is the user's id or the organization's own id for them, e.g. "U001". */
type Ctx = { params: Promise<{ slug: string; userId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug, userId } = await params;
    const caller = await getCaller(request, slug);
    requirePermission(caller, (r) => canManageUsers(r) || canViewAudit(r), "see users");
    return json(publicUser(await getUser(caller.org.id, userId)));
  });
}

/** PATCH: change any field POST accepts; "password" sets a new one. Null clears an optional field. */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug, userId } = await params;
    const caller = await getCaller(request, slug);
    requirePermission(caller, canManageUsers, "edit users");
    return json(await updateUser(caller.org.id, caller.actor, userId, await readJson(request)));
  });
}

/** DELETE: only for a user nothing refers to; otherwise 409, and set status to "terminated". */
export async function DELETE(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug, userId } = await params;
    const caller = await getCaller(request, slug);
    requirePermission(caller, canManageUsers, "delete users");
    await deleteUser(caller.org.id, caller.actor, userId);
    return new Response(null, { status: 204 });
  });
}
