// Gives one account the demo password (DEMO_PASSWORD in .env.local). Part of the database reset: runs directly against Postgres.
// Usage: npx tsx scripts/set-demo-password.ts <email>
import path from "path";

process.loadEnvFile(path.join(import.meta.dirname, "../.env.local"));
const { one, pool } = await import("../src/lib/db");
const { setPassword } = await import("../src/services/auth.service");

const email = process.argv[2];
const password = process.env.DEMO_PASSWORD;
if (!email || !password) throw new Error("Usage: set-demo-password.ts <email>, with DEMO_PASSWORD in .env.local");
const user = await one<{ user_id: string }>("SELECT user_id FROM users WHERE lower(email)=lower($1)", [email]);
if (!user) throw new Error(`No user ${email}`);
await setPassword(pool, user.user_id, password);
await pool.end();
