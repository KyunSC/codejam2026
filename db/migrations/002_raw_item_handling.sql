-- Brings a database created before raw item handling up to db/schema.sql: the append-only record of how AP dealt with a
-- raw item that holds no invoice or could not be read. Safe to run more than once; keeps all data.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/migrations/002_raw_item_handling.sql
BEGIN;
CREATE TABLE IF NOT EXISTS raw_item_handling (
  handling_id          bigserial PRIMARY KEY,
  organization_id      text NOT NULL REFERENCES organizations,
  raw_item_id          text NOT NULL REFERENCES raw_items,
  outcome              text NOT NULL CHECK (outcome IN ('requested','reviewed','answered','forwarded','dismissed')),
  forwarded_to_user_id text REFERENCES users,
  note                 text NOT NULL,
  handled_by           text NOT NULL REFERENCES users,
  handled_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'forwarded') = (forwarded_to_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS raw_item_handling_latest ON raw_item_handling (raw_item_id, handling_id DESC);

CREATE OR REPLACE FUNCTION raw_item_handling_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'raw_item_handling is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS raw_item_handling_no_change ON raw_item_handling;
CREATE TRIGGER raw_item_handling_no_change BEFORE UPDATE OR DELETE ON raw_item_handling
  FOR EACH ROW EXECUTE FUNCTION raw_item_handling_append_only();
COMMIT;
