-- Migration 018: SALUT membership application flow
-- Adds application tracking columns to users table and creates storage bucket

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS salut_status TEXT NOT NULL DEFAULT 'none'
    CHECK (salut_status IN ('none', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS salut_applied_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS salut_payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS salut_rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS salut_approved_at       TIMESTAMPTZ;

-- Backfill existing SALUT members so state is consistent
UPDATE users
  SET salut_status = 'approved', salut_approved_at = NOW()
  WHERE is_salut = true AND salut_status = 'none';

-- Create private storage bucket for payment proofs (service role access only)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('salut-proofs', 'salut-proofs', false)
  ON CONFLICT (id) DO NOTHING;
