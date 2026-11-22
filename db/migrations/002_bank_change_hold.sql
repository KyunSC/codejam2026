-- Brings a database created before the bank change cooling-off up to db/schema.sql: the business date payments
-- to a vendor are held until after its bank details change, and who waived a hold, when and why.
-- Safe to run more than once; keeps all data.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/migrations/002_bank_change_hold.sql
BEGIN;
ALTER TABLE vendor_bank_changes
  ADD COLUMN IF NOT EXISTS hold_until        date,
  ADD COLUMN IF NOT EXISTS hold_waived_by    text REFERENCES users,
  ADD COLUMN IF NOT EXISTS hold_waived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS hold_waive_reason text;
COMMIT;
