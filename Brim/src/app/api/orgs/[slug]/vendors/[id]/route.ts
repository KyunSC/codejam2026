import { getCaller } from "@/lib/context";
import { AppError, handle, json } from "@/lib/http";
import { getVendor } from "@/lib/workflow/vendors";

/** GET /api/orgs/{slug}/vendors/{id}: the vendor, its AP invoices and card charges, bank changes (by role). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  return handle(async () => {
    const { slug, id } = await params;
    const caller = await getCaller(request, slug);
    if (!caller.user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
    return json(await getVendor(caller.user, id));
  });
}
