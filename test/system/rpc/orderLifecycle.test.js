'use strict';

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb, resetDb, closeDb, skipReason } = require('../helpers/db');
const { makeUser, makeOrder, makeCart, callRpc } = require('../helpers/factories');

describe('cancel_order', { skip: skipReason() }, () => {
  let sql;
  before(async () => { sql = await getDb(); });
  beforeEach(async () => { await resetDb(sql); });
  after(async () => { await closeDb(); });

  test('a pending order is cancelled and its payment written off together', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'pending' });

    await callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: user.id });

    const [updated] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
    const [payment] = await sql`SELECT status FROM payments WHERE order_id = ${order.id}`;
    assert.equal(updated.status, 'cancelled');
    assert.equal(payment.status, 'failed');
  });

  test('an order already being fulfilled cannot be cancelled', async () => {
    for (const status of ['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered']) {
      const user = await makeUser(sql);
      const { order } = await makeOrder(sql, user, { status });

      await assert.rejects(
        () => callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: user.id }),
        /Hanya pesanan pending/,
        `${status} should not be cancellable`,
      );

      const [after] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
      assert.equal(after.status, status, 'the order was left untouched');
    }
  });

  test('one shopper cannot cancel another shopper\'s order', async () => {
    const owner = await makeUser(sql);
    const stranger = await makeUser(sql);
    const { order } = await makeOrder(sql, owner, { status: 'pending' });

    await assert.rejects(
      () => callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: stranger.id }),
      /tidak ditemukan/,
    );

    const [after] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
    assert.equal(after.status, 'pending');
  });

  test('an order that does not exist reports as not found', async () => {
    const user = await makeUser(sql);
    await assert.rejects(
      () => callRpc(sql, 'cancel_order', {
        p_order_id: '11111111-1111-1111-1111-111111111111', p_user_id: user.id,
      }),
      /tidak ditemukan/,
    );
  });

  test('a payment already settled is not written off by a cancellation', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'pending', payment_status: 'paid' });

    await callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: user.id });

    const [payment] = await sql`SELECT status FROM payments WHERE order_id = ${order.id}`;
    assert.equal(payment.status, 'paid');
  });

  test('two people cancelling at once produce one cancellation, not two', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'pending' });

    const results = await Promise.allSettled([
      callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: user.id }),
      callRpc(sql, 'cancel_order', { p_order_id: order.id, p_user_id: user.id }),
    ]);

    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  });
});

describe('confirm_payment', { skip: skipReason() }, () => {
  let sql;
  before(async () => { sql = await getDb(); });
  beforeEach(async () => { await resetDb(sql); });
  after(async () => { await closeDb(); });

  test('a payment on an awaiting order settles both records', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'awaiting_payment' });

    await callRpc(sql, 'confirm_payment', { p_order_id: order.id });

    const [updated] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
    const [payment] = await sql`SELECT status, paid_at FROM payments WHERE order_id = ${order.id}`;
    assert.equal(updated.status, 'paid');
    assert.equal(payment.status, 'paid');
    assert.ok(payment.paid_at, 'the settlement time is recorded');
  });

  test('payment cannot be recorded before stock has been confirmed', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'pending' });

    await assert.rejects(
      () => callRpc(sql, 'confirm_payment', { p_order_id: order.id }),
      /tidak dalam status menunggu pembayaran/,
    );

    const [after] = await sql`SELECT status FROM orders WHERE id = ${order.id}`;
    assert.equal(after.status, 'pending');
  });

  test('an already-paid order is refused rather than settled twice', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'paid', payment_status: 'paid' });

    await assert.rejects(() => callRpc(sql, 'confirm_payment', { p_order_id: order.id }));
  });

  test('an unknown order reports as not found', async () => {
    await assert.rejects(
      () => callRpc(sql, 'confirm_payment', { p_order_id: '11111111-1111-1111-1111-111111111111' }),
      /tidak ditemukan/,
    );
  });

  test('an order awaiting payment with nothing left to settle is refused', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, {
      status: 'awaiting_payment', payment_status: 'expired',
    });

    await assert.rejects(
      () => callRpc(sql, 'confirm_payment', { p_order_id: order.id }),
      /Pembayaran tidak ditemukan atau sudah dikonfirmasi/,
    );
  });

  test('two admins confirming at once settle it once', async () => {
    const user = await makeUser(sql);
    const { order } = await makeOrder(sql, user, { status: 'awaiting_payment' });

    const results = await Promise.allSettled([
      callRpc(sql, 'confirm_payment', { p_order_id: order.id }),
      callRpc(sql, 'confirm_payment', { p_order_id: order.id }),
    ]);

    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const paid = await sql`SELECT count(*)::int AS n FROM payments WHERE order_id = ${order.id} AND status = 'paid'`;
    assert.equal(paid[0].n, 1);
  });
});

describe('get_or_create_cart', { skip: skipReason() }, () => {
  let sql;
  before(async () => { sql = await getDb(); });
  beforeEach(async () => { await resetDb(sql); });
  after(async () => { await closeDb(); });

  test('a first visit creates the cart', async () => {
    const user = await makeUser(sql);
    const cartId = await callRpc(sql, 'get_or_create_cart', { p_user_id: user.id });
    assert.ok(cartId);
  });

  test('a return visit finds the same cart', async () => {
    const user = await makeUser(sql);
    const existing = await makeCart(sql, user.id);

    const cartId = await callRpc(sql, 'get_or_create_cart', { p_user_id: user.id });

    assert.equal(cartId, existing.id);
    const carts = await sql`SELECT count(*)::int AS n FROM carts WHERE user_id = ${user.id}`;
    assert.equal(carts[0].n, 1);
  });

  test('ten simultaneous requests still leave exactly one cart', async () => {
    // Two browser tabs opening at once must not create two carts; the unique
    // constraint plus the upsert is what prevents it.
    const user = await makeUser(sql);

    const ids = await Promise.all(
      Array.from({ length: 10 }, () => callRpc(sql, 'get_or_create_cart', { p_user_id: user.id })),
    );

    assert.equal(new Set(ids).size, 1, 'every caller got the same cart');
    const carts = await sql`SELECT count(*)::int AS n FROM carts WHERE user_id = ${user.id}`;
    assert.equal(carts[0].n, 1);
  });

  test('different shoppers get different carts', async () => {
    const alice = await makeUser(sql);
    const bob = await makeUser(sql);

    const [a, b] = await Promise.all([
      callRpc(sql, 'get_or_create_cart', { p_user_id: alice.id }),
      callRpc(sql, 'get_or_create_cart', { p_user_id: bob.id }),
    ]);

    assert.notEqual(a, b);
  });
});
