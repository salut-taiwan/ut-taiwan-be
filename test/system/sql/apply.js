'use strict';

// Applies the migration manifest to a Postgres database, in order.
//
// There is no migration runner in this project — migrations are pasted into
// the Supabase SQL editor by hand — so this exists to give the system tier a
// database, and to give CI something that fails when a migration does not
// parse or when a new file is never added to the manifest.
//
// Run directly:  SYSTEST_DB_URL=postgres://... node test/system/sql/apply.js

const fs = require('node:fs');
const path = require('node:path');
const postgres = require('postgres');

const SQL_DIR = __dirname;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');
const MANIFEST = path.join(SQL_DIR, 'migrations.manifest.txt');

/** Filenames listed in the manifest, in order, comments stripped. */
function readManifest() {
  return fs.readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

/** Filenames the manifest explicitly skips, with the reason kept alongside. */
function readSkipList() {
  return fs.readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map(line => line.match(/^#\s*SKIP\s+(\S+)/))
    .filter(Boolean)
    .map(match => match[1]);
}

/** Local test-tier SQL wins, so 000_* can live outside the real history. */
function resolveSql(name) {
  for (const dir of [SQL_DIR, MIGRATIONS_DIR]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `The manifest lists "${name}" but it exists in neither ${SQL_DIR} nor ${MIGRATIONS_DIR}.\n` +
    'Add the file, or remove the line from migrations.manifest.txt.',
  );
}

/**
 * Every migration must be listed or explicitly skipped. Catches the case where
 * someone adds a migration and the system tier silently stops matching
 * production.
 */
function assertNoDrift() {
  const listed = new Set([...readManifest(), ...readSkipList()]);
  const onDisk = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const missing = onDisk.filter(f => !listed.has(f));
  if (missing.length > 0) {
    throw new Error(
      `These migrations are not in the manifest:\n  ${missing.join('\n  ')}\n` +
      `Add each to ${MANIFEST}, or mark it "# SKIP <file>" with a reason.`,
    );
  }
  return onDisk.length;
}

/**
 * Apply every manifest entry.
 *
 * .simple() switches postgres.js to the simple query protocol, so a file with
 * several statements and dollar-quoted function bodies goes over in one round
 * trip inside an implicit transaction — a syntax error rolls that file back
 * rather than leaving the schema half-built.
 */
async function applyManifest(url, { log = () => {} } = {}) {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    for (const name of readManifest()) {
      const file = resolveSql(name);
      const body = fs.readFileSync(file, 'utf8');
      if (!body.trim()) { log(`  skipped ${name} (empty)`); continue; }
      const startedAt = Date.now();
      try {
        await sql.unsafe(body).simple();
      } catch (err) {
        throw new Error(`Migration failed: ${name}\n  ${err.message}`, { cause: err });
      }
      log(`  applied ${name} (${Date.now() - startedAt}ms)`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** True when the schema is already built, so a warm database can be reused. */
async function isProvisioned(url) {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql`SELECT to_regclass('public.payments') IS NOT NULL AS ok`;
    return row.ok;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = { applyManifest, isProvisioned, readManifest, readSkipList, assertNoDrift, resolveSql, MIGRATIONS_DIR };

if (require.main === module) {
  const url = process.env.SYSTEST_DB_URL;
  if (!url) {
    console.error('SYSTEST_DB_URL is required, e.g. postgres://postgres:postgres@127.0.0.1:5432/ut_taiwan_test');
    process.exit(1);
  }
  const total = assertNoDrift();
  console.log(`  manifest covers all ${total} migrations`);
  applyManifest(url, { log: console.log })
    .then(() => console.log('  schema ready'))
    .catch(err => { console.error(err.message); process.exit(1); });
}
