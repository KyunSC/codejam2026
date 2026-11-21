import { modelStatus } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only way the client learns which model is in use and whether the stand-in is active. Never exposes the key. */
export async function GET() {
  return Response.json(modelStatus(), { headers: { "Cache-Control": "no-store" } });
}
