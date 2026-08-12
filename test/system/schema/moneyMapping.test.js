'use strict';

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');
const { drizzle } = require('drizzle-orm/postgres-js');

const { getDb, resetDb, closeDb, skipReason } = require('../helpers/db');
const { makeUser, makeModule, makeOrder } = require('../helpers/factories');
const dbSchema = require('../../../db/schema');

// The regression guard for the bug this whole effort started from: drizzle
// returned numeric columns as strings, so "0.00" was truthy and every
// `=== 0` check silently failed. Only a real numeric column can prove the
// mapping is right.

describe('money columns read back as numbers', { skip: skipReason() }, () => {
  let sql;
  let db;

  before(async () => {
    sql = await getDb();
    db = drizzle({ client: sql, schema: dbSchema });
  });
  beforeEach(async () => { await resetDb(sql); });
  after(async () => { await closeDb(); });

  test('a module price is a number, not a string', async () => {
    const mod = await makeModule(sql, { price_student: 50000, price_general: 60000 });

    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(typeof row.price_student, 'number');
    assert.equal(row.price_student, 50000);
  });

  test('a zero price satisfies a strict equality check', async () => {
    // This is the exact comparison that broke: "0.00" === 0 is false, so a
    // free item was treated as priced and rendered as "Gratis" where it should
    // have read "harga menyusul".
    const mod = await makeModule(sql, { price_student: 0 });

    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(row.price_student, 0);
    assert.ok(row.price_student === 0, 'a zero price must compare equal to zero');
    assert.equal(Boolean(row.price_student), false, 'and must be falsy');
  });

  test('a null price stays null rather than becoming zero', async () => {
    const mod = await makeModule(sql, { price_student: null });

    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(row.price_student, null);
  });

  test('order and payment amounts are numbers throughout', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user);

    const row = await db.query.orders.findFirst({
      where: eq(dbSchema.orders.id, order.id),
      with: { order_items: true, payments: true },
    });

    for (const field of ['subtotal', 'shipping_cost', 'box_fee', 'admin_fee', 'total_amount']) {
      assert.equal(typeof row[field], 'number', `orders.${field} should be a number`);
    }
    assert.equal(typeof row.order_items[0].unit_price, 'number');
    assert.equal(typeof row.payments[0].amount, 'number');
  });

  test('the largest amount the column allows survives the round trip', async () => {
    const mod = await makeModule(sql, { price_student: 9999999999.99 });

    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(row.price_student, 9999999999.99);
  });

  test('a fractional amount keeps both decimal places', async () => {
    const mod = await makeModule(sql, { price_student: 12345.67 });

    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(row.price_student, 12345.67);
  });

  test('writing a number back reads the same number', async () => {
    const mod = await makeModule(sql, { price_student: 1000 });

    await db.update(dbSchema.modules)
      .set({ price_student: 75000 })
      .where(eq(dbSchema.modules.id, mod.id));
    const row = await db.query.modules.findFirst({ where: eq(dbSchema.modules.id, mod.id) });

    assert.equal(row.price_student, 75000);
    assert.equal(typeof row.price_student, 'number');
  });

  test('a raw query bypasses the mapping and still returns strings', async () => {
    // Documented so nobody reaches for db.execute and reintroduces the bug:
    // only the declared columns get the number treatment.
    const mod = await makeModule(sql, { price_student: 50000 });

    const rows = await sql`SELECT price_student FROM modules WHERE id = ${mod.id}`;

    assert.equal(typeof rows[0].price_student, 'string');
  });

  test('a raw result is an array with no rows property', async () => {
    // The shape that made two free-almet claim guards dead code: they tested
    // `result.rows`, which is always undefined on this driver.
    const result = await sql`SELECT 1 AS x`;

    assert.ok(Array.isArray(result));
    assert.equal(result.rows, undefined);
    assert.equal(result.length, 1);
  });
});
