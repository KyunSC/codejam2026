import { handler } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { auditBatch } from "@/lib/auditEvents";

export const GET = handler(async (req, user) => {
  assertCan(user, "audit.view");
  const sp = new URL(req.url).searchParams;
  const before = sp.get("before");
  return auditBatch(user.organization_id!, sp.get("q") ?? "", before ? Number(before) : null);
});
