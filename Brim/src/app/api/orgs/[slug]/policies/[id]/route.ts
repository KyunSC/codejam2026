import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { requireAction } from "@/lib/workflow/guard";
import type { IdCtx } from "@/lib/workflow/http";
import { type RuleDraft, updatePolicy } from "@/lib/workflow/policies";

/** PUT /api/orgs/{slug}/policies/{id} { active?, when?, effect?, note? } (controller): 422 LOCKED_RULE, BAD_CONDITION. */
export async function PUT(request: Request, { params }: IdCtx) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "admin.edit");
    const body = await readJson(request);
    return json(await db().$transaction((tx) => updatePolicy(tx, actor, caller.org.id, id, body as RuleDraft)));
  });
}
