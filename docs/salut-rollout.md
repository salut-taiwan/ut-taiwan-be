# SALUT contribution and registration update

This branch changes SALUT contributions to NTD 1,700 once during study and
records a Taiwan mobile number and a free-text almamater size on student profiles.

## Before deployment

1. Identify the actual Railway service serving the frontend API and the matching
   Supabase project. Inspect the `public.users` schema before applying SQL.
2. Apply only the additive migrations `032_salut_payment_note.sql` and
   `033_registration_profile_fields.sql` to the verified database. They add
   nullable columns and preserve existing students and payment records.
3. Do not rerun migration 022. It historically resets membership records.
4. Run this branch's unit/route tests and a staging registration/payment review.
5. When testing the Vercel frontend branch, optionally set
   `FRONTEND_PREVIEW_URL` to its exact HTTPS origin on the relevant Railway
   backend service. Keep `FRONTEND_URL` on the production website. Wildcard
   preview domains are intentionally not supported.

## Deploy and verify

Deploy the prepared backend code through the verified Railway service after
the additive schema changes are available. Confirm these public responses:

- `/api/config/registration`: `profile_fields_version` equals `1`.
- `/api/config/fees`: `salutMembership.billing` equals `once_per_study` and
  both student fee tiers equal `1700` (the old tier enum remains compatible).

On the existing Vercel preview, check registration, profile editing, login by
email/NIM, receipt upload, pending status, and admin approval/rejection using
dedicated test accounts. These are manual checks until the real staging
services are connected; local tests do not verify real email, storage or DB.

Do not mark all historical expired records paid automatically. The existing
admin must verify their payment history. Existing approved timestamps remain
the basis for the once-per-study status; admin revocation still works.

The new registration form refuses to send data to an older backend that would
silently ignore the two new fields. The backend still accepts the old form
format while frontend and backend deployments are rolled out separately.

## Operational contacts

The SALUT account modal uses the bank details supplied by the site owner.
Configure the treasurer's WhatsApp number in the frontend's
`NEXT_PUBLIC_SALUT_TREASURER_WHATSAPP` when the owner supplies it. Until then,
the interface directs students to the existing SALUT contact for assistance.
