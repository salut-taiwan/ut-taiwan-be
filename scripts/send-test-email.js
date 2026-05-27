#!/usr/bin/env node
/**
 * send-test-email.js
 *
 * Sends a single SALUT-approved email through the production emailService code
 * path to surface the actual Resend response (success or error) without going
 * through any controller / auth / order flow.
 *
 * Usage: node scripts/send-test-email.js <recipient-email>
 *
 * Possible outputs and what they mean:
 *   [Email] sent { id }                                — Resend accepted; check inbox / dashboard / spam.
 *   name: 'validation_error', statusCode: 403          — domain not verified or sandbox restriction.
 *   name: 'invalid_api_key', statusCode: 403           — RESEND_API_KEY in .env is wrong / rotated.
 *   name: 'restricted_api_key', statusCode: 401        — API key missing send scope.
 *   name: 'daily_quota_exceeded',  statusCode: 429     — free-tier daily cap hit.
 *   name: 'monthly_quota_exceeded', statusCode: 429    — free-tier monthly cap hit.
 *   name: 'rate_limit_exceeded',   statusCode: 429     — too many sends; default 5 req/s.
 */

'use strict';

const emailService = require('../services/emailService');

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    console.error('Usage: node scripts/send-test-email.js <recipient-email>');
    process.exit(1);
  }

  console.log(`Sending test SALUT-approved email to ${to}…`);
  await emailService.sendSalutApproved({
    email: to,
    name: 'Diagnostic Test',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  console.log('Done. See the [Email] log line above for the Resend response.');
}

main().catch((err) => {
  console.error('Script threw:', err);
  process.exit(1);
});
