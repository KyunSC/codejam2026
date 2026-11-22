import { handler } from "@/lib/api";
import { ForbiddenError } from "@/lib/authz";
import { getRawItem, readStoredFile } from "@/services/rawIntake.service";

// The stored attachment, shown beside the parsed invoice.
export const GET = handler<RouteContext<"/api/raw-items/[id]/file">>(async (req, user, ctx) => {
  if (!user) throw new ForbiddenError("Sign in");
  const raw = await getRawItem(user, (await ctx.params).id);
  const name = new URL(req.url).searchParams.get("name");
  const f = raw?.files.find((x) => x.file_name === name);
  if (!f) throw new ForbiddenError("No such file");
  return new Response(new Uint8Array(readStoredFile(f)), { headers: { "content-type": f.mime_type, "content-disposition": `inline; filename="${f.file_name}"` } });
});
