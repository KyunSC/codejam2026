-- Brings a database created before contract types were removed up to db/schema.sql: a contract with a monthly fee is
-- checked as a fixed monthly fee, so its type is no longer stored. Safe to run more than once; keeps all other data.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/migrations/003_drop_contract_type.sql
ALTER TABLE contracts DROP COLUMN IF EXISTS billing_type;
