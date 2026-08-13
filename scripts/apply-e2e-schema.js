'use strict';

// Applies the migration manifest to the local Supabase stack.
//
// Same ordering as the system tier, minus 000_supabase_stubs.sql: the real
// stack already provides the auth and storage schemas that stub stands in for.

require('dotenv').config({ path: '.env.e2e' });

const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres');
const { readManifest, resolveSql, assertNoDrift, isProvisioned } = require('../test/system/sql/apply');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required — copy .env.e2e.example to .env.e2e');
  process.exit(1);
}
if (!/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error(`Refusing to apply to a non-local database: ${url}`);
  process.exit(1);
}

/**
 * Grant the PostgREST roles access to everything the manifest created.
 *
 * A real Supabase project does this for you: tables made through its own
 * migration flow inherit grants for anon/authenticated/service_role, and RLS
 * is what actually restricts them. This script runs raw SQL as `postgres`, so
 * the tables it creates are owned by postgres with no grants at all — and the
 * backend, which talks to PostgREST as service_role, gets
 * "permission denied for table users" on every admin request.
 *
 * Idempotent, and run on every invocation rather than only on a fresh apply:
 * a stack provisioned before this existed still needs them.
 */
async function grantPostgrestRoles(sql) {
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `).simple();
  console.log('  PostgREST roles granted');
}

async function main() {
  assertNoDrift();

  // 001 creates RLS policies, which are not idempotent, so a second apply
  // fails on the first one. Re-running the whole set is only meaningful on a
  // fresh stack anyway — use `supabase db reset` to start over.
  if (await isProvisioned(url)) {
    console.log('  schema already present — skipping (supabase db reset to rebuild)');
    const existing = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await grantPostgrestRoles(existing);
    } finally {
      await existing.end({ timeout: 5 });
    }
    return;
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    for (const name of readManifest()) {
      if (name === '000_supabase_stubs.sql') continue;
      const body = fs.readFileSync(resolveSql(name), 'utf8');
      if (!body.trim()) continue;
      try {
        await sql.unsafe(body).simple();
      } catch (err) {
        throw new Error(`Migration failed: ${name}\n  ${err.message}`);
      }
    }
    console.log('  schema applied to the local Supabase stack');
    await grantPostgrestRoles(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
