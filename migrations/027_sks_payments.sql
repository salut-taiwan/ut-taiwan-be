-- Migration 027: Bantuan Bayar SKS — students pay SALUT in NTD,
-- SALUT pays Universitas Terbuka in IDR on their behalf.
-- Each submission is one course-registration payment slip.

CREATE TABLE IF NOT EXISTS sks_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nim                 VARCHAR(20) NOT NULL,
  name                TEXT NOT NULL,
  semester_period     TEXT NOT NULL,
  idr_amount          NUMERIC(14, 2) NOT NULL CHECK (idr_amount > 0),
  ntd_amount          NUMERIC(10, 2) NOT NULL CHECK (ntd_amount > 0),
  rate_idr_per_ntd    NUMERIC(8, 2)  NOT NULL,
  ut_slip_url         TEXT NOT NULL,
  transfer_proof_url  TEXT NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed','rejected')),
  rejection_reason    TEXT,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sks_payments_user_status_created
  ON sks_payments(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sks_payments_status_created
  ON sks_payments(status, created_at DESC);
