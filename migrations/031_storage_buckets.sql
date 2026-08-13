-- Migration 031: the storage buckets the app uploads to.
--
-- Three buckets are written to by controllers, and until now only one of them
-- (salut-proofs, in migration 018) existed in this repo. payment-docs and
-- sks-payment-files were created by hand in the Supabase dashboard, so nothing
-- recorded that they had to exist:
--
--   * rebuilding the project from migrations produced a database where every
--     transfer-proof, invoice and SKS-slip upload failed with a storage error;
--   * the acceptance suite could not run those paths at all until its schema
--     script started creating the buckets itself as a workaround.
--
-- All three are private. Nothing is served from a public URL: the controllers
-- read them through the service role and hand out short-lived signed URLs
-- (5 minutes), so the objects are only reachable by someone an admin
-- deliberately gave a link to.
--
-- Idempotent, and safe against the live project — every bucket already there
-- keeps its existing row.

INSERT INTO storage.buckets (id, name, public) VALUES
  -- Bank transfer proofs and Karunika invoices (payments controller).
  ('payment-docs',      'payment-docs',      false),
  -- UT payment slips and transfer proofs for SKS help (sksPayment controller).
  ('sks-payment-files', 'sks-payment-files', false),
  -- SALUT membership payment proofs. Already created by migration 018; listed
  -- here so this file is the single description of what the app needs.
  ('salut-proofs',      'salut-proofs',      false)
ON CONFLICT (id) DO NOTHING;
