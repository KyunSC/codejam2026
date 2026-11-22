-- Workspace preferences, for a database created before they existed. Safe to run more than once.
-- The same table is in db/schema.sql for fresh databases.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
