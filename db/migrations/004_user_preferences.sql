-- Brings a database created before dashboard customization up to db/schema.sql: each user's dashboard preferences.
-- Safe to run more than once; keeps all data.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/migrations/004_user_preferences.sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
