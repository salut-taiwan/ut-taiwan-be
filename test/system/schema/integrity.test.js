'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTableConfig } = require('drizzle-orm/pg-core');

const { getDb, closeDb, skipReason } = require('../helpers/db');
const { assertNoDrift } = require('../sql/apply');
const schema = require('../../../db/schema');

// Guards against the schema in db/schema.js and the schema the migrations
// actually build drifting apart, and against the migration set growing a file
// nobody applied.

describe('migration integrity', { skip: skipReason() }, () => {
  let sql;
  before(async () => { sql = await getDb(); });
  after(async () => { await closeDb(); });

  test('every migration on disk is either applied or explicitly skipped', () => {
    assert.doesNotThrow(() => assertNoDrift());
  });

  test('checkout_order exists exactly once', async () => {
    // CREATE OR REPLACE with a changed signature adds an overload rather than
    // replacing, and four of them accumulated across 005/014/016/017. Callers
    // that pass fewer named arguments then get "function is not unique"
    // instead of a checkout. Migration 030 collapses them.
    const rows = await sql`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'checkout_order'`;
    assert.equal(rows.length, 1, `expected one checkout_order, found:\n${rows.map(r => r.args).join('\n')}`);
  });

  test('the surviving checkout_order still accepts everything the backend sends', async () => {
    const [row] = await sql`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'checkout_order'`;
    for (const param of ['p_unique_code', 'p_box_fee', 'p_admin_fee', 'p_is_salut_order', 'p_order_items']) {
      assert.ok(row.args.includes(param), `${param} is missing from the signature`);
    }
  });

  test('each remaining stored procedure exists exactly once', async () => {
    for (const name of ['cancel_order', 'confirm_payment', 'get_or_create_cart', 'apply_scraper_changes']) {
      const rows = await sql`
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = ${name}`;
      assert.equal(rows.length, 1, `${name} should be defined once`);
    }
  });

  test('every table drizzle declares exists in the database', async () => {
    const declared = Object.values(schema)
      .filter(v => v && typeof v === 'object' && v[Symbol.for('drizzle:IsDrizzleTable')])
      .map(t => getTableConfig(t).name);
    assert.ok(declared.length > 15, 'the schema should declare the full table set');

    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const actual = new Set(rows.map(r => r.table_name));

    for (const name of declared) {
      assert.ok(actual.has(name), `table ${name} is declared in db/schema.js but missing from the database`);
    }
  });

  test('every money column is numeric with two decimal places', async () => {
    const rows = await sql`
      SELECT table_name, column_name, numeric_scale
        FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'numeric'`;
    assert.ok(rows.length > 10);
    for (const row of rows) {
      assert.equal(row.numeric_scale, 2, `${row.table_name}.${row.column_name} should keep two decimals`);
    }
  });

  test('an order can reach the awaiting-payment stage', async () => {
    // Added by 009; without it the Karunika confirmation fails at the check
    // constraint rather than in application code.
    const rows = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'orders_status_check'`;
    assert.ok(rows[0].def.includes('awaiting_payment'));
  });

  test('a cart line is either a module or a SKU, never both or neither', async () => {
    const rows = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'cart_items'::regclass AND contype = 'c'`;
    assert.ok(
      rows.some(r => r.def.includes('module_id') && r.def.includes('sku_id')),
      'the module-or-SKU check constraint is missing',
    );
  });

  test('the same module cannot be added to one cart twice', async () => {
    const rows = await sql`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'cart_items' AND indexdef ILIKE '%unique%'`;
    assert.ok(rows.some(r => r.indexdef.includes('module_id')));
    assert.ok(rows.some(r => r.indexdef.includes('sku_id')));
  });

  test('a merchandise order item may have no module code', async () => {
    // 021 made this nullable; merch reuses the module_* columns.
    const [row] = await sql`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'order_items' AND column_name = 'module_code'`;
    assert.equal(row.is_nullable, 'YES');
  });

  test('a membership can be recorded as expired', async () => {
    const rows = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'users_salut_status_check'`;
    assert.ok(rows[0].def.includes('expired'));
  });

  test('the WhatsApp column added by 029 is present', async () => {
    const rows = await sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'salut_wa_number'`;
    assert.equal(rows.length, 1);
  });

  test('the connection bypasses row-level security, as the service role does', async () => {
    // Stated explicitly so nobody assumes this tier exercises RLS. It does not:
    // production reaches Postgres with the service role too, and RLS guards the
    // frontend's direct reads rather than this backend.
    const [row] = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    assert.equal(row.rolbypassrls, true);
  });
});
