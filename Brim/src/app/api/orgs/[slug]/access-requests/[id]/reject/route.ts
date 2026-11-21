import { rejectAccessRequest } from "@/lib/access/service";
import { canManageUsers, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { handle, json, readJson } from "@/lib/http";

/** POST /api/orgs/{slug}/access-requests/{id}/reject { note? } */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    requirePermission(caller, canManageUsers, "reject account requests");
    return json(await rejectAccessRequest(caller.org.id, caller.actor, id, await readJson(request)));
  });
}
