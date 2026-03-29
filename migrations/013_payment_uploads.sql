-- Migration 013: Add payment upload columns (paths only — files proxied through backend)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS proof_path        TEXT,
  ADD COLUMN IF NOT EXISTS invoice_path      TEXT,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;