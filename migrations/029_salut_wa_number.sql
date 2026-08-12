-- Migration 029: WhatsApp number captured with each SALUT application.
--
-- Admins add approved members to the SALUT WhatsApp group. users.phone can be a
-- stale registration-time number (or a Taiwanese line that isn't on WhatsApp),
-- so the application snapshots the number the student is reachable on right now,
-- alongside the fee and semester snapshots added in migration 022.
-- Stored as bare international digits ("628123456789") so it drops into wa.me.

ALTER TABLE users ADD COLUMN IF NOT EXISTS salut_wa_number TEXT;

-- Best-effort backfill for applications already pending, so admins aren't left
-- chasing the current queue by hand.
UPDATE users
   SET salut_wa_number = regexp_replace(
         CASE WHEN phone ~ '^0' THEN '62' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
              ELSE phone END,
         '\D', '', 'g')
 WHERE salut_wa_number IS NULL
   AND salut_status = 'pending'
   AND phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 8;
