import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { setVendorStatus } from "@/lib/workflow/vendors";

/** POST /api/orgs/{slug}/vendors/{id}/release-hold { reason? } (finance manager, controller): 403 FOUR_EYES. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const reason = typeof body.reason === "string" ? body.reason : null;
    return json(await db().$transaction((tx) => setVendorStatus(tx, workflowActor(caller.user!), id, "release-hold", reason)));
  });
}
