'use strict';

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb, resetDb, closeDb, skipReason } = require('../helpers/db');
const {
  makeUser, makeModule, makeProductWithSku, makeCart,
  addModuleToCart, addSkuToCart, checkoutParams, callRpc,
} = require('../helpers/factories');

// checkout_order is the only place an order, its items, its payment and the
// emptying of the cart happen together. The integration tier can assert the
// parameters we send it; only this tier can assert what it does.

describe('checkout_order', { skip: skipReason() }, () => {
  let sql;

  before(async () => { sql = await getDb(); });
  beforeEach(async () => { await resetDb(sql); });
  after(async () => { await closeDb(); });

  const moduleItem = (mod, over = {}) => ({
    module_id: mod.id,
    module_code: mod.tbo_code,
    module_name: mod.name,
    quantity: 2,
    unit_price: 50000,
    subtotal: 100000,
    is_request: false,
    ...over,
  });

  test('an order, its items, its payment and an empty cart all land together', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod, { quantity: 2 });

    const result = await callRpc(sql, 'checkout_order',
      checkoutParams(user, { p_order_items: [moduleItem(mod)] }));

    assert.ok(result.order.id);
    assert.ok(result.payment.id);

    const [order] = await sql`SELECT * FROM orders WHERE id = ${result.order.id}`;
    assert.equal(order.status, 'pending');

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${result.order.id}`;
    assert.equal(items.length, 1);
    assert.equal(items[0].module_code, mod.tbo_code);

    const remaining = await sql`SELECT * FROM cart_items WHERE cart_id = ${cart.id}`;
    assert.equal(remaining.length, 0, 'the cart is emptied in the same transaction');
  });

  test('a user with no cart cannot check out', async () => {
    const user = await makeUser(sql);
    await assert.rejects(
      () => callRpc(sql, 'checkout_order', checkoutParams(user)),
      /Keranjang tidak ditemukan/,
    );
  });

  test('a module that went out of stock is refused, and the message names it', async () => {
    // The controller pattern-matches this exact text to answer 400 rather than
    // 500, so the wording is a contract between the SQL and the JavaScript.
    const user = await makeUser(sql);
    const mod = await makeModule(sql, { is_available: false, tbo_code: 'GONE1234' });
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    await assert.rejects(
      () => callRpc(sql, 'checkout_order', checkoutParams(user, { p_order_items: [moduleItem(mod)] })),
      /Modul tidak tersedia: GONE1234/,
    );
  });

  test('an out-of-stock module already marked as a request goes through', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql, { is_available: false });
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod, { is_request: true });

    const result = await callRpc(sql, 'checkout_order',
      checkoutParams(user, { p_order_items: [moduleItem(mod, { is_request: true })] }));

    assert.ok(result.order.id);
  });

  test('merchandise is never blocked by module availability', async () => {
    const user = await makeUser(sql);
    await makeModule(sql, { is_available: false });
    const { sku } = await makeProductWithSku(sql);
    const cart = await makeCart(sql, user.id);
    await addSkuToCart(sql, cart.id, sku);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [{
        module_id: null, module_code: null, module_name: 'Kaos Uji',
        quantity: 1, unit_price: 120000, subtotal: 120000,
        is_request: false, sku_id: sku.id, variant_label: 'M',
      }],
    }));

    assert.ok(result.order.id);
  });

  test('only request items are queued for an admin to price', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [
        moduleItem(mod, { is_request: false }),
        { ...moduleItem(mod, { is_request: true }), module_code: 'REQ1', module_id: null },
      ],
    }));

    const rows = await sql`
      SELECT is_request, request_status FROM order_items
       WHERE order_id = ${result.order.id} ORDER BY is_request`;
    assert.equal(rows[0].request_status, null, 'a stocked item needs no decision');
    assert.equal(rows[1].request_status, 'pending', 'a request waits for one');
  });

  test('the payment records the unique code that makes a transfer identifiable', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [moduleItem(mod)],
      p_unique_code: 417,
      p_payment_amount: 525417,
    }));

    const [payment] = await sql`SELECT * FROM payments WHERE order_id = ${result.order.id}`;
    assert.equal(payment.unique_code, 417);
    assert.equal(Number(payment.amount), 525417);
    assert.equal(payment.status, 'pending');
  });

  test('a merch line keeps its SKU and variant, which is what makes it shippable', async () => {
    const user = await makeUser(sql);
    const { sku } = await makeProductWithSku(sql);
    const cart = await makeCart(sql, user.id);
    await addSkuToCart(sql, cart.id, sku, { variant_label: 'L / Navy' });

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [{
        module_id: null, module_code: null, module_name: 'Jas Almamater',
        quantity: 1, unit_price: 350000, subtotal: 350000,
        is_request: false, sku_id: sku.id, variant_label: 'L / Navy',
      }],
    }));

    const [item] = await sql`SELECT * FROM order_items WHERE order_id = ${result.order.id}`;
    assert.equal(item.sku_id, sku.id);
    assert.equal(item.variant_label, 'L / Navy');
    assert.equal(item.module_code, null);
  });

  test('a free item is stored at zero rather than being rejected', async () => {
    const user = await makeUser(sql);
    const { sku } = await makeProductWithSku(sql, { base_price: 0, price: 0, claim_rule: 'salut_sem1_once' });
    const cart = await makeCart(sql, user.id);
    await addSkuToCart(sql, cart.id, sku, { price_snapshot: 0 });

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_subtotal: 0,
      p_order_items: [{
        module_id: null, module_code: null, module_name: 'Almet SALUT',
        quantity: 1, unit_price: 0, subtotal: 0,
        is_request: false, sku_id: sku.id, variant_label: 'M',
      }],
    }));

    const [item] = await sql`SELECT * FROM order_items WHERE order_id = ${result.order.id}`;
    assert.equal(Number(item.unit_price), 0);
  });

  test('a custom request with no catalogue entry is allowed', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [{
        module_id: null, module_code: 'EKMA4111', module_name: 'EKMA4111',
        quantity: 1, unit_price: 0, subtotal: 0, is_request: true,
      }],
    }));

    const [item] = await sql`SELECT * FROM order_items WHERE order_id = ${result.order.id}`;
    assert.equal(item.request_status, 'pending');
  });

  test('a failure part-way through leaves nothing behind, cart included', async () => {
    // A duplicate order number trips a unique constraint after the guards have
    // passed and rows have already been written.
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const taken = 'UT-2026-DUPLICATE';
    await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_number: taken, p_order_items: [moduleItem(mod)],
    }));
    await addModuleToCart(sql, cart.id, mod);

    const before = await sql`SELECT count(*)::int AS n FROM orders`;
    await assert.rejects(() => callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_number: taken, p_order_items: [moduleItem(mod)],
    })));

    const after = await sql`SELECT count(*)::int AS n FROM orders`;
    assert.equal(after[0].n, before[0].n, 'no partial order survived');

    const stillThere = await sql`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${cart.id}`;
    assert.equal(stillThere[0].n, 1, 'the cart was not emptied by a failed checkout');
  });

  test('one shopper checking out does not touch another shopper\'s cart', async () => {
    const alice = await makeUser(sql);
    const bob = await makeUser(sql);
    const mod = await makeModule(sql);
    const aliceCart = await makeCart(sql, alice.id);
    const bobCart = await makeCart(sql, bob.id);
    await addModuleToCart(sql, aliceCart.id, mod);
    await addModuleToCart(sql, bobCart.id, mod);

    await callRpc(sql, 'checkout_order', checkoutParams(alice, { p_order_items: [moduleItem(mod)] }));

    const bobItems = await sql`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${bobCart.id}`;
    assert.equal(bobItems[0].n, 1);
  });

  test('the fee columns round-trip exactly, including a waiver', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_order_items: [moduleItem(mod)],
      p_shipping_cost: 0, p_box_fee: 0, p_admin_fee: 0,
      p_is_salut_order: true, p_total_amount: 100000,
    }));

    const [order] = await sql`SELECT * FROM orders WHERE id = ${result.order.id}`;
    assert.equal(Number(order.shipping_cost), 0);
    assert.equal(order.is_salut_order, true);
    assert.equal(Number(order.total_amount), 100000);
  });

  test('amounts survive the numeric column without drifting', async () => {
    const user = await makeUser(sql);
    const mod = await makeModule(sql);
    const cart = await makeCart(sql, user.id);
    await addModuleToCart(sql, cart.id, mod);

    const result = await callRpc(sql, 'checkout_order', checkoutParams(user, {
      p_subtotal: 1234567.89,
      p_total_amount: 1234567.89,
      p_payment_amount: 1234567.89,
      p_order_items: [moduleItem(mod, { unit_price: 617283.945, subtotal: 1234567.89 })],
    }));

    const [order] = await sql`SELECT subtotal FROM orders WHERE id = ${result.order.id}`;
    assert.equal(Number(order.subtotal), 1234567.89);
  });
});
