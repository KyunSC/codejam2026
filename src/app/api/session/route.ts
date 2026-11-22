import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { setSession } from "@/lib/auth";

// Sign in by email (the dataset has no passwords).
export async function POST(req: Request) {
  const { email } = (await req.json()) as { email: string };
  const user = await one<{ user_id: string; role: string }>("SELECT user_id, role FROM users WHERE lower(email)=lower($1) AND status<>'terminated'", [email]);
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });
  await setSession(user.user_id);
  return NextResponse.json(user);
}
