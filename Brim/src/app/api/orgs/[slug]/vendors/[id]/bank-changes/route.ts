import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { requestBankChange } from "@/lib/workflow/vendors";

/** POST /api/orgs/{slug}/vendors/{id}/bank-changes { institution, transit, account, channel } (AP clerk). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    const body = await readJson(request);
    return json(await db().$transaction((tx) => requestBankChange(tx, workflowActor(caller.user!), id, body)), 201);
  });
}
