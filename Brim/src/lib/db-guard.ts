/**
 * Stops a run that must stay local (the overnight Loop A) from touching the shared database.
 *
 * Opt-in: only active when BRIM_LOCAL_DB_ONLY=1. Loop A starts Claude Code with it set, so
 * every command the loop runs inherits it, whatever its .env says. dotenv never overrides a
 * variable that is already set, so a shared .env cannot switch it off.
 *
 * Called by prisma.config.ts (migrate, db push, seed, studio) and by db() (app code, tests,
 * scripts).
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const URL_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const;

export function dbHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function assertLocalDbIfRequired(env: Record<string, string | undefined> = process.env): void {
  if (env.BRIM_LOCAL_DB_ONLY?.trim() !== "1") return;
  for (const name of URL_VARS) {
    const url = env[name]?.trim();
    if (!url) continue;
    const host = dbHost(url);
    if (!host || !LOCAL_HOSTS.has(host)) {
      throw new Error(
        `BRIM_LOCAL_DB_ONLY=1, but ${name} points at ${host ?? "a URL that does not parse"}. ` +
          "This run may only use a local database. Move the shared .env aside " +
          "(mv .env .env.neon) and point DATABASE_URL and DATABASE_URL_UNPOOLED at localhost.",
      );
    }
  }
}
