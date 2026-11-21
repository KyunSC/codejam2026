import { requireBrimAdmin } from "@/lib/context";
import { handle, json, readJson } from "@/lib/http";
import { createOrganization, listOrganizations } from "@/lib/organizations/service";

/** GET /api/admin/organizations?q=: organizations, with user, invoice and pending-request counts. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireBrimAdmin(request);
    return json(await listOrganizations(new URL(request.url).searchParams.get("q") ?? undefined));
  });
}

/** POST /api/admin/organizations { slug, name, admin?: { fullName, email, password } }: onboard. */
export async function POST(request: Request) {
  return handle(async () => {
    const actor = await requireBrimAdmin(request);
    return json(await createOrganization(await readJson(request), actor), 201);
  });
}
