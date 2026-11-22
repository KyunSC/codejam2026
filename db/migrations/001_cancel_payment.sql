-- Brings a database created before payment cancelling up to db/schema.sql: the 'cancelled' status
-- and who cancelled a payment, when and why. Safe to run more than once; keeps all data.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/migrations/001_cancel_payment.sql
BEGIN;
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cancelled_by  text REFERENCES users,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('scheduled','released','outstanding','settled','failed','cancelled'));
COMMIT;
