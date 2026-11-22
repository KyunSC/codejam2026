import { writeAudit } from "@/lib/audit";
import { one, query, tx } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import {
  PREFERENCES_VERSION, migratePreferences, resolvePreferences, type ResolvedPreferences, type StoredPreferences,
} from "@/lib/preferences";
import { preferencesSchema } from "@/lib/preferences.schema";
import type { User } from "@/lib/types";

// Each user's workspace preferences. Always the signed-in user's own: there is no way to read or change someone else's.
// Only what the user changed is stored; resolvePreferences fills in the defaults and drops what the role can't open.

export type PreferencesView = { stored: StoredPreferences; resolved: ResolvedPreferences };

type Row = { prefs: unknown; version: number };

const view = (user: User, stored: StoredPreferences): PreferencesView => ({ stored, resolved: resolvePreferences(stored, user) });

// JSON with object keys sorted, so two documents that differ only in key order compare equal. Array order counts.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function getPreferences(user: User): Promise<PreferencesView> {
  const row = await one<Row>("SELECT prefs, version FROM user_preferences WHERE user_id = $1", [user.user_id]);
  return view(user, row ? migratePreferences(row.prefs, row.version) : {});
}

// Replace the user's stored document. Nothing is written, and no audit row, when it hasn't changed.
export async function savePreferences(user: User, input: unknown): Promise<PreferencesView> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join(".") : "preferences";
    throw new ValidationError(`${where}: ${issue.message}`);
  }
  const next = parsed.data as StoredPreferences;
  return tx(async (c) => {
    const row = await one<Row>("SELECT prefs, version FROM user_preferences WHERE user_id = $1 FOR UPDATE", [user.user_id], c);
    const before = row ? migratePreferences(row.prefs, row.version) : {};
    if (stable(before) === stable(next)) return view(user, before);
    await query(
      `INSERT INTO user_preferences (user_id, prefs, version, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, version = EXCLUDED.version, updated_at = now()`,
      [user.user_id, JSON.stringify(next), PREFERENCES_VERSION],
      c,
    );
    await writeAudit(c, { organizationId: user.organization_id, actor: user, action: "preferences.update", entityType: "user_preferences", entityId: user.user_id, before, after: next });
    return view(user, next);
  });
}

// Back to all defaults. The row stays, emptied, so the reset is an update like any other change.
export async function resetPreferences(user: User): Promise<PreferencesView> {
  return tx(async (c) => {
    const row = await one<Row>("SELECT prefs, version FROM user_preferences WHERE user_id = $1 FOR UPDATE", [user.user_id], c);
    const before = row ? migratePreferences(row.prefs, row.version) : {};
    if (!Object.keys(before).length) return view(user, {});
    await query("UPDATE user_preferences SET prefs = '{}'::jsonb, version = $2, updated_at = now() WHERE user_id = $1", [user.user_id, PREFERENCES_VERSION], c);
    await writeAudit(c, { organizationId: user.organization_id, actor: user, action: "preferences.reset", entityType: "user_preferences", entityId: user.user_id, before, after: {} });
    return view(user, {});
  });
}
