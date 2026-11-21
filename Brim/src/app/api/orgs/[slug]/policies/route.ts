import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { listPolicies } from "@/lib/workflow/policies";

/** GET /api/orgs/{slug}/policies: the rules as rows and the editor's dropdown choices (controller; auditor reads). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    return json(await db().$transaction((tx) => listPolicies(tx, caller.user)));
  });
}
