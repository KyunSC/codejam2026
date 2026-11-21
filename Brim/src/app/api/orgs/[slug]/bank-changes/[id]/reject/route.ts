import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { decideBankChange } from "@/lib/workflow/vendors";

/** POST /api/orgs/{slug}/bank-changes/{id}/reject { calledBack?, note } (finance manager, controller): 403 FOUR_EYES; 422 CALLBACK_REQUIRED. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    const body = await readJson(request);
    const note = typeof body.note === "string" ? body.note : null;
    return json(
      await db().$transaction((tx) => decideBankChange(tx, workflowActor(caller.user!), id, "reject", { calledBack: body.calledBack === true, note }), { timeout: 60_000 }),
    );
  });
}
