import { requestAccess } from "@/lib/access/service";
import { handle, json, readJson } from "@/lib/http";

/**
 * POST /api/auth/signup { organization, fullName, email, password, requestedRole?, message? }
 * Files an account request; a controller/admin at that organization approves it.
 */
export async function POST(request: Request) {
  return handle(async () => json(await requestAccess(await readJson(request)), 201));
}
