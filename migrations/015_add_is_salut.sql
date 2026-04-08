-- Add SALUT membership flag to users
-- SALUT members have reduced handling fee (no +Rp 425.000/semester surcharge)
-- Set exclusively by admins; users default to non-SALUT (false)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_salut BOOLEAN DEFAULT false NOT NULL;
