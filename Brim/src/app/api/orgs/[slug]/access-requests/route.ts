import { listAccessRequests } from "@/lib/access/service";
import { canManageUsers, requirePermission } from "@/lib/auth/permissions";
import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";

/** GET /api/orgs/{slug}/access-requests?status=&q=: account requests. Controller/admin only. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const caller = await getCaller(request, (await params).slug);
    requirePermission(caller, canManageUsers, "see account requests");
    const q = new URL(request.url).searchParams;
    return json(await listAccessRequests(caller.org.id, { status: q.get("status") ?? undefined, q: q.get("q") ?? undefined }));
  });
}
