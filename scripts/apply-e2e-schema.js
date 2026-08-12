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

async function main() {
  assertNoDrift();

  // 001 creates RLS policies, which are not idempotent, so a second apply
  // fails on the first one. Re-running the whole set is only meaningful on a
  // fresh stack anyway — use `supabase db reset` to start over.
  if (await isProvisioned(url)) {
    console.log('  schema already present — skipping (supabase db reset to rebuild)');
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
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
