import { connection } from "next/server";
import { db } from "@/lib/db";
import { today } from "@/lib/today";

export async function GET() {
  await connection(); // never prerender: the point is to hit the database per request
  try {
    // An empty table is healthy. A missing table or column fails the query.
    await db().invoice.findFirst({ select: { id: true, version: true } });
    return Response.json({ ok: true, database: "up", today: today() });
  } catch (err) {
    // Log the detail server-side; the response stays generic so it never echoes a host or URL.
    console.error("[health] database check failed", err);
    return Response.json({ ok: false, database: "down", today: today() }, { status: 503 });
  }
}
