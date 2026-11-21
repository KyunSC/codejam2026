import { getCaller } from "@/lib/context";
import { db } from "@/lib/db";
import { AppError, handle, json, readJson } from "@/lib/http";
import { workflowActor } from "@/lib/workflow/guard";
import { listVendors, onboardVendor } from "@/lib/workflow/vendors";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/orgs/{slug}/vendors?q=: every vendor, fields by role (bank masked). */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    return json(await listVendors(caller.user, new URL(request.url).searchParams.get("q") ?? undefined));
  });
}

/** POST /api/orgs/{slug}/vendors (AP clerk): created pending_review; 409 VENDOR_EXISTS. */
export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const { slug } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    const body = await readJson(request);
    return json(await db().$transaction((tx) => onboardVendor(tx, workflowActor(caller.user!), body)), 201);
  });
}
