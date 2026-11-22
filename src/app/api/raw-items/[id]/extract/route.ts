import { handler } from "@/lib/api";
import { extract } from "@/services/pipeline.service";

export const POST = handler<RouteContext<"/api/raw-items/[id]/extract">>(async (_req, user, ctx) => extract(user, (await ctx.params).id));
