ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_ntd_code    TEXT,
  ADD COLUMN IF NOT EXISTS bank_ntd_name    TEXT,
  ADD COLUMN IF NOT EXISTS bank_ntd_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_idr_name    TEXT,
  ADD COLUMN IF NOT EXISTS bank_idr_account TEXT;
