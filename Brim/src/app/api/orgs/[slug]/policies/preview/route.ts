import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { previewPolicies, type RuleDraft } from "@/lib/workflow/policies";

/** POST /api/orgs/{slug}/policies/preview { invoiceId, drafts: { P01: {...} } }: the chain before and after the draft. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const body = await readJson(request);
    const drafts = (body.drafts && typeof body.drafts === "object" ? body.drafts : {}) as Record<string, RuleDraft>;
    return json(
      await db().$transaction((tx) => previewPolicies(tx, caller.user, { invoiceId: String(body.invoiceId ?? ""), drafts }), { timeout: 60_000 }),
    );
  });
}
