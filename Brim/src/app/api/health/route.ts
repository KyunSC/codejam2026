import { connection } from "next/server";
import { db } from "@/lib/db";
import { today } from "@/lib/today";

/**
 * Phase 0 "done when": the deployed app reaches Neon. GET /api/health runs `SELECT 1`
 * at request time and reports the app date. 200 when the database answers, 503 otherwise.
 */
export async function GET() {
  await connection(); // never prerender: the point is to hit the database per request
  try {
    const rows = await db().$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return Response.json({ ok: rows[0]?.ok === 1, database: "up", today: today() });
  } catch (err) {
    // Log the detail server-side; the response stays generic so it never echoes a host or URL.
    console.error("[health] database check failed", err);
    return Response.json({ ok: false, database: "down", today: today() }, { status: 503 });
  }
}
