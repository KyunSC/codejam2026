import { handler } from "@/lib/api";
import { importRecords } from "@/services/organization.service";

export const POST = handler<RouteContext<"/api/organizations/[id]/records">>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const { kind, rows } = await req.json();
  await importRecords(user, id, kind, rows);
  return { imported: rows.length };
});
