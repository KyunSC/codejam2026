import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { simulateBankRun } from "@/lib/workflow/payments";

/** POST /api/orgs/{slug}/payments/simulate-bank (AP clerk, finance manager, controller). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    const role = caller.user?.role;
    if (!caller.user || !role || !["ap_clerk", "finance_manager", "controller_admin"].includes(role)) {
      throw new AppError(403, "FORBIDDEN", "Your role can't run the bank simulation.");
    }
    const actor = workflowActor(caller.user);
    return json(await db().$transaction((tx) => simulateBankRun(tx, actor, caller.org.id), { timeout: 120_000 }));
  });
}
