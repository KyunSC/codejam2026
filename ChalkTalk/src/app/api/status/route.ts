// Aliased: the spec names it useStandIn, which the React hooks lint rule mistakes for a hook.
import { useStandIn as standInActive } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only way the client learns whether the stand-in is active. Never exposes the key. */
export async function GET() {
  return Response.json({ standIn: standInActive() }, { headers: { "Cache-Control": "no-store" } });
}
