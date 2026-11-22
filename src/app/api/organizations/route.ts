import { handler } from "@/lib/api";
import { createOrganization } from "@/services/organization.service";

export const POST = handler(async (req, user) => ({ organization_id: await createOrganization(user, await req.json()) }));
