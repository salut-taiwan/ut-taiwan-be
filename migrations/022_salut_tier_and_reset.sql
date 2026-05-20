-- Migration 022: SALUT membership tier (NTD) + annual May 1 reset
-- - Adds fee/semester snapshot columns to users.
-- - Extends the salut_status check constraint to allow 'expired'.
-- - One-time reset: flips every currently-approved SALUT member to non-SALUT
--   so they must re-apply at the new NTD tier prices.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS salut_applied_fee_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS salut_applied_semester   INTEGER;

-- Migration 018 added an inline CHECK on salut_status; Postgres auto-named it
-- users_salut_status_check. Drop it (whatever name it ended up with) and recreate
-- with 'expired' added.
DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'users'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%salut_status%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_salut_status_check
  CHECK (salut_status IN ('none', 'pending', 'approved', 'rejected', 'expired'));

-- Reset every currently-approved SALUT member. Audit trail preserved via status='expired'.
UPDATE users
SET is_salut          = false,
    salut_status      = 'expired',
    salut_approved_at = NULL
WHERE is_salut = true;
