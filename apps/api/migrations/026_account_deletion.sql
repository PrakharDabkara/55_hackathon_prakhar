-- Up Migration
-- Customer account deletion (ADR-0054). A deleted customer keeps their row, so requests and orders
-- still point somewhere, but the phone is erased: the row is anonymised, not removed. The phone was
-- NOT NULL UNIQUE; UNIQUE ignores NULLs, so the same number can register again as a new account.
-- The format CHECK passes for NULL. Only relaxes and adds: the previous release keeps working.

ALTER TABLE users
  ALTER COLUMN phone DROP NOT NULL,
  ADD COLUMN deleted_at timestamptz;

-- Down Migration
-- Deleted rows have no phone, so NOT NULL cannot come back while any exist.
ALTER TABLE users DROP COLUMN deleted_at;
