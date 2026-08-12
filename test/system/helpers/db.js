'use strict';

// Shared plumbing for the system tier: a real Postgres, the migration manifest
// applied to it, and truncation between tests.
//
// The tier skips itself with a clear reason when Docker is unavailable, rather
// than failing a run on a machine that never opted into it.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const postgres = require('postgres');
const { applyManifest, isProvisioned } = require('../sql/apply');

const COMPOSE_FILE = path.join(__dirname, '..', 'docker-compose.yml');
const DEFAULT_URL = 'postgres://postgres:postgres@127.0.0.1:55432/ut_taiwan_test';

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * A reason string when the tier cannot run, or false when it can.
 * Passed straight to describe(..., { skip }).
 */
function skipReason() {
  if (process.env.SYSTEST_DB_URL) return false;
  if (!dockerAvailable()) {
    return 'Docker is unavailable — start it and re-run `npm run test:system`';
  }
  return false;
}

let client = null;
let ready = null;

/** Boot the container if needed, apply the manifest once, return a client. */
async function getDb() {
  ready ??= (async () => {
    const url = process.env.SYSTEST_DB_URL ?? DEFAULT_URL;

    if (!process.env.SYSTEST_DB_URL) {
      execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait'], {
        stdio: 'ignore', timeout: 180000,
      });
    }
    if (!(await isProvisioned(url))) {
      await applyManifest(url);
    }
    client = postgres(url, { max: 8, prepare: false, onnotice: () => {} });
    return client;
  })();
  return ready;
}

// Everything a test may write. Reference data from 002 stays: it is read-only
// and re-seeding it per test would cost more than it saves. auth.users is
// included because public.users has a foreign key into it, so it must go in
// the same cascade.
const MUTABLE_TABLES = [
  'auth.users',
  'public.users', 'public.carts', 'public.cart_items',
  'public.orders', 'public.order_items', 'public.payments',
  'public.modules', 'public.module_history', 'public.scraper_runs',
  'public.subject_modules',
  'public.products', 'public.product_images', 'public.product_variant_types',
  'public.product_variant_options', 'public.product_skus',
  'public.sks_payments',
];

/**
 * Wipe everything a test may have written.
 *
 * Truncation rather than a wrapping transaction: the RPCs open their own
 * transactions and take row locks, and the concurrency tests need two
 * connections to see each other's committed work — neither is possible inside
 * one outer transaction that gets rolled back.
 */
async function resetDb(sql) {
  // A fire-and-forget query from the previous request can still hold a row;
  // let those drain, then fail loudly rather than stalling if one does not.
  await new Promise(resolve => setImmediate(resolve));
  await sql.unsafe("SET lock_timeout = '5s'");
  await sql.unsafe(`TRUNCATE ${MUTABLE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    ready = null;
  }
}

module.exports = { getDb, resetDb, closeDb, skipReason, MUTABLE_TABLES, DEFAULT_URL };
