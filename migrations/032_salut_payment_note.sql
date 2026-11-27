-- Additive only: preserve every existing payment, status and approval timestamp.
ALTER TABLE users ADD COLUMN IF NOT EXISTS salut_payment_note TEXT;
