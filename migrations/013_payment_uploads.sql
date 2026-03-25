-- Migration 013: Add payment upload columns
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS proof_url         TEXT,
  ADD COLUMN IF NOT EXISTS invoice_url       TEXT,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;