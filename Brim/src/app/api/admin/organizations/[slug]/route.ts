import { requireBrimAdmin } from "@/lib/context";
import { handle, json, readJson } from "@/lib/http";
import { getOrganizationBySlug, updateOrganization } from "@/lib/organizations/service";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/admin/organizations/{slug}. Brim staff only. */
export async function GET(request: Request, { params }: Ctx) {
  return handle(async () => {
    await requireBrimAdmin(request);
    return json(await getOrganizationBySlug((await params).slug));
  });
}

/** PATCH /api/admin/organizations/{slug} { name }: rename. Brim staff only. */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const actor = await requireBrimAdmin(request);
    return json(await updateOrganization((await params).slug, await readJson(request), actor));
  });
}
