import { getCaller } from "@/lib/context";
import { handle, json } from "@/lib/http";
import { fraudWatch } from "@/lib/workflow/fraud";

/** GET /api/orgs/{slug}/fraud: every open fraud flag with the amount at stake (finance manager, controller). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    return json(await fraudWatch(caller.user));
  });
}
