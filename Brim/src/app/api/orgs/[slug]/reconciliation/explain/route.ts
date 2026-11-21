import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";
import { requireAction } from "@/lib/workflow/guard";
import { markExplained } from "@/lib/workflow/reconciliation";

/** POST /api/orgs/{slug}/reconciliation/explain { lineId | paymentId, note }: 422 REASON_REQUIRED, 409 ALREADY_MATCHED / ALREADY_EXPLAINED. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const actor = requireAction(caller, "flag.resolve.fraud");
    const body = await readJson(request);
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return json(
      await db().$transaction((tx) => markExplained(tx, actor, caller.org.id, { lineId: str(body.lineId), paymentId: str(body.paymentId), note: str(body.note) }), { timeout: 60_000 }),
    );
  });
}
