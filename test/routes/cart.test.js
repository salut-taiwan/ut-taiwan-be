'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, insertChain, deleteChain, updateChain,
  selectChain, freshIp,
} = require('../helpers/testApp');

const CART_ID = '11111111-1111-1111-1111-111111111111';
const MODULE_ID = '22222222-2222-2222-2222-222222222222';
const SKU_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';

const pgResult = (rows = []) => Object.assign([...rows], { count: rows.length });

const moduleRow = (over = {}) => ({
  id: MODULE_ID, price_student: 50000, is_available: true, deleted_at: null, ...over,
});

const cartModuleItem = (over = {}) => ({
  id: ITEM_ID,
  quantity: 2,
  price_snapshot: 50000,
  is_request: false,
  modules: {
    id: MODULE_ID, tbo_code: 'MKDU4109', name: 'Bahasa Inggris',
    cover_image_url: null, is_available: true,
  },
  ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  items = [cartModuleItem()],
  mod = moduleRow(),
  sku,
  existingItem,
  pkg,
  claimed = [],
  user: userRow = { salut_approved_at: null, current_semester: 3 },
  select,
} = {}) {
  harness = stubBackend({
    user: studentUser(),
    rpc: (fn) => (fn === 'get_or_create_cart' ? { data: CART_ID, error: null } : { data: null, error: null }),
    query: {
      cart_items: { findMany: async () => items, findFirst: async () => existingItem },
      modules: { findFirst: async () => mod },
      product_skus: { findFirst: async () => sku },
      packages: { findFirst: async () => pkg },
      users: { findFirst: async () => userRow },
    },
    insert: insertChain([{ id: ITEM_ID }]),
    delete: deleteChain([{ id: ITEM_ID }]),
    update: updateChain([{ id: ITEM_ID }]),
    select: select ?? selectChain([]),
    execute: async () => pgResult(claimed),
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('GET /api/cart', () => {
  test('a module line reports its code, name and per-line subtotal', async () => {
    setup();
    const res = await authed('get', '/api/cart');
    assert.equal(res.status, 200);
    const [item] = res.body.items;
    assert.equal(item.itemType, 'module');
    assert.equal(item.tboCode, 'MKDU4109');
    assert.equal(item.subtotal, 100000);
  });

  test('a merch line reports its SKU and variant instead of a module code', async () => {
    setup({
      items: [{
        id: ITEM_ID, quantity: 1, price_snapshot: 350000, is_request: false,
        sku_id: SKU_ID, variant_label: 'L', product_name_snapshot: 'Jas Almamater',
        product_skus: { id: SKU_ID, products: { id: 'p-1', name: 'Jas', product_images: [] } },
      }],
    });
    const res = await authed('get', '/api/cart');
    const [item] = res.body.items;
    assert.equal(item.itemType, 'merch');
    assert.equal(item.variantLabel, 'L');
    assert.equal(item.isAvailable, true);
  });

  test('a merch cover image is the lowest sort_order, not the first row returned', async () => {
    setup({
      items: [{
        id: ITEM_ID, quantity: 1, price_snapshot: 350000, is_request: false, sku_id: SKU_ID,
        product_skus: {
          id: SKU_ID,
          products: {
            id: 'p-1', name: 'Jas',
            product_images: [
              { image_url: 'https://x/second.jpg', sort_order: 2 },
              { image_url: 'https://x/first.jpg', sort_order: 1 },
            ],
          },
        },
      }],
    });
    const res = await authed('get', '/api/cart');
    assert.match(res.body.items[0].coverImageUrl, /first\.jpg$/);
  });

  test('a module that went out of stock after being added is flagged stale', async () => {
    setup({
      items: [cartModuleItem({
        modules: { id: MODULE_ID, tbo_code: 'X', name: 'X', cover_image_url: null, is_available: false },
      })],
    });
    const res = await authed('get', '/api/cart');
    assert.equal(res.body.items[0].isStale, true);
    assert.equal(res.body.hasStaleItems, true);
  });

  test('a request already converted is not stale', async () => {
    setup({
      items: [cartModuleItem({
        is_request: true,
        modules: { id: MODULE_ID, tbo_code: 'X', name: 'X', cover_image_url: null, is_available: false },
      })],
    });
    const res = await authed('get', '/api/cart');
    assert.equal(res.body.items[0].isStale, false);
    assert.equal(res.body.hasStaleItems, false);
  });

  test('a request with no price yet is flagged so the UI can say "harga menyusul"', async () => {
    setup({ items: [cartModuleItem({ is_request: true, price_snapshot: 0 })] });
    const res = await authed('get', '/api/cart');
    assert.equal(res.body.items[0].isPricePending, true);
  });

  test('totals aggregate across mixed module and merch lines', async () => {
    setup({
      items: [
        cartModuleItem(),
        {
          id: 'ci-2', quantity: 1, price_snapshot: 350000, is_request: false, sku_id: SKU_ID,
          product_skus: { id: SKU_ID, products: { id: 'p-1', name: 'Jas', product_images: [] } },
        },
      ],
    });
    const res = await authed('get', '/api/cart');
    assert.equal(res.body.subtotal, 450000);
    assert.equal(res.body.itemCount, 3);
  });

  test('an active member sees the service fees waived in the breakdown', async () => {
    setup({ user: { salut_approved_at: new Date().toISOString() } });
    const res = await authed('get', '/api/cart');
    for (const line of res.body.total_breakdown.fee_lines) {
      assert.equal(line.is_waived, true);
      assert.equal(line.amount, 0);
    }
  });

  test('a non-member is charged the fees', async () => {
    setup();
    const res = await authed('get', '/api/cart');
    assert.equal(res.body.total_breakdown.fee_lines.every(l => l.is_waived === false), true);
  });
});

describe('POST /api/cart/items', () => {
  test('moduleId is required', async () => {
    setup();
    const res = await authed('post', '/api/cart/items').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'moduleId wajib diisi');
  });

  test('an unknown module is a 404', async () => {
    setup({ mod: null });
    const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Modul tidak ditemukan');
  });

  test('a soft-deleted module is a 404 even though the row still exists', async () => {
    setup({ mod: moduleRow({ deleted_at: '2026-01-01T00:00:00Z' }) });
    const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(res.status, 404);
  });

  test('a priced, in-stock module is added as a normal purchasable line', async () => {
    const h = setup();
    const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(res.status, 201);
    assert.equal(h.calls.values[0].is_request, false);
    assert.equal(h.calls.values[0].price_snapshot, 50000);
  });

  test('an out-of-stock module is added as a request', async () => {
    const h = setup({ mod: moduleRow({ is_available: false }) });
    await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(h.calls.values[0].is_request, true);
  });

  test('an unpriced module is added as a request, not as a free item', async () => {
    const h = setup({ mod: moduleRow({ price_student: 0 }) });
    await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(h.calls.values[0].is_request, true);
    assert.equal(h.calls.values[0].price_snapshot, 0);
  });

  test('adding the same module twice increments rather than replaces the quantity', async () => {
    const h = setup();
    await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID, quantity: 2 });
    const conflict = h.calls.onConflict[0];
    assert.ok(conflict.set.quantity, 'the conflict clause must adjust the quantity');
    assert.notEqual(conflict.set.quantity, 2, 'it increments, it does not overwrite');
  });

  test('a re-add refreshes the stored price and request flag', async () => {
    const h = setup();
    await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    const conflict = h.calls.onConflict[0];
    assert.equal(conflict.set.price_snapshot, 50000);
    assert.equal(conflict.set.is_request, false);
  });

  test('a negative quantity is refused — it used to decrement an existing line', async () => {
    const h = setup();
    const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID, quantity: -3 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Jumlah tidak valid');
    assert.equal(h.calls.insert.length, 0);
  });

  test('a zero or fractional quantity is refused', async () => {
    setup();
    for (const bad of [0, 1.5, 'two', null]) {
      const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID, quantity: bad });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
    }
  });

  test('the quantity defaults to one when omitted', async () => {
    const h = setup();
    const res = await authed('post', '/api/cart/items').send({ moduleId: MODULE_ID });
    assert.equal(res.status, 201);
    assert.equal(h.calls.values[0].quantity, 1);
  });
});

describe('PUT /api/cart/items/:itemId', () => {
  test('an omitted quantity is refused instead of being written to the column', async () => {
    const h = setup({ existingItem: { id: ITEM_ID } });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Jumlah tidak valid');
    assert.deepEqual(h.calls.set, []);
  });

  test('a null or non-numeric quantity is refused', async () => {
    setup({ existingItem: { id: ITEM_ID } });
    for (const bad of [null, 'abc', {}]) {
      const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} should be refused`);
    }
  });

  test('a negative quantity is refused', async () => {
    setup({ existingItem: { id: ITEM_ID } });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: -1 });
    assert.equal(res.status, 400);
  });

  test('setting the quantity to zero removes the line', async () => {
    const h = setup({ existingItem: { id: ITEM_ID } });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: 0 });
    assert.equal(res.status, 200);
    assert.equal(h.calls.delete.length, 1);
  });

  test('a positive quantity updates the line', async () => {
    const h = setup({ existingItem: { id: ITEM_ID } });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: 3 });
    assert.equal(res.status, 200);
    assert.deepEqual(h.calls.set, [{ quantity: 3 }]);
  });

  test('an item outside the caller\'s own cart is a 404', async () => {
    setup({ existingItem: undefined });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: 2 });
    assert.equal(res.status, 404);
  });

  test('the free almet cannot be raised above one unit', async () => {
    setup({
      existingItem: { id: ITEM_ID, product_skus: { id: SKU_ID, products: { claim_rule: 'salut_sem1_once' } } },
    });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: 2 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /1 unit per anggota/);
  });

  test('the free almet may still be set to exactly one', async () => {
    setup({
      existingItem: { id: ITEM_ID, product_skus: { id: SKU_ID, products: { claim_rule: 'salut_sem1_once' } } },
    });
    const res = await authed('put', `/api/cart/items/${ITEM_ID}`).send({ quantity: 1 });
    assert.equal(res.status, 200);
  });
});

describe('DELETE /api/cart', () => {
  test('removing one item scopes the delete to the caller\'s cart', async () => {
    const h = setup();
    const res = await authed('delete', `/api/cart/items/${ITEM_ID}`);
    assert.equal(res.status, 200);
    assert.equal(h.calls.delete.length, 1);
  });

  test('clearing the cart deletes by cart, not by item', async () => {
    const h = setup({ items: [] });
    const res = await authed('delete', '/api/cart');
    assert.equal(res.status, 200);
    assert.equal(h.calls.delete.length, 1);
  });
});

describe('PATCH /api/cart/items/:itemId/convert-to-request', () => {
  test('an unavailable module converts to a request', async () => {
    const h = setup({
      existingItem: { id: ITEM_ID, module_id: MODULE_ID },
      mod: moduleRow({ is_available: false }),
    });
    const res = await authed('patch', `/api/cart/items/${ITEM_ID}/convert-to-request`);
    assert.equal(res.status, 200);
    assert.deepEqual(h.calls.set, [{ is_request: true }]);
  });

  test('a module back in stock is refused — there is nothing to convert', async () => {
    const h = setup({ existingItem: { id: ITEM_ID, module_id: MODULE_ID }, mod: moduleRow() });
    const res = await authed('patch', `/api/cart/items/${ITEM_ID}/convert-to-request`);
    assert.equal(res.status, 400);
    assert.deepEqual(h.calls.set, []);
  });

  test('an item outside the caller\'s cart is a 404', async () => {
    setup({ existingItem: undefined });
    const res = await authed('patch', `/api/cart/items/${ITEM_ID}/convert-to-request`);
    assert.equal(res.status, 404);
  });
});

describe('POST /api/cart/merch', () => {
  const skuRow = (over = {}) => ({
    id: SKU_ID,
    price: 350000,
    option_names: ['L', 'Navy'],
    products: { id: 'p-1', name: 'Jas Almamater', claim_rule: null },
    ...over,
  });

  test('skuId is required', async () => {
    setup();
    const res = await authed('post', '/api/cart/merch').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'skuId wajib diisi');
  });

  test('an unknown SKU is a 404', async () => {
    setup({ sku: null });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(res.status, 404);
  });

  test('the variant label is built from the option names', async () => {
    const h = setup({ sku: skuRow() });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(res.status, 201);
    assert.equal(h.calls.values[0].variant_label, 'L / Navy');
  });

  test('a SKU with no options has no variant label', async () => {
    const h = setup({ sku: skuRow({ option_names: [] }) });
    await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(h.calls.values[0].variant_label, null);
  });

  test('an unusable quantity is floored to one rather than refused', async () => {
    const h = setup({ sku: skuRow() });
    await authed('post', '/api/cart/merch').send({ skuId: SKU_ID, quantity: -5 });
    assert.equal(h.calls.values[0].quantity, 1);
  });

  test('the free almet is refused to a non-member', async () => {
    setup({
      sku: skuRow({ price: 0, products: { id: 'p-free', name: 'Almet', claim_rule: 'salut_sem1_once' } }),
      user: { salut_approved_at: null, current_semester: 1 },
    });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(res.status, 403);
  });

  test('the free almet is refused when already claimed', async () => {
    setup({
      sku: skuRow({ price: 0, products: { id: 'p-free', name: 'Almet', claim_rule: 'salut_sem1_once' } }),
      user: { salut_approved_at: new Date().toISOString(), current_semester: 1 },
      claimed: [{ '?column?': 1 }],
    });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Almet gratis sudah pernah diklaim');
  });

  test('the free almet cannot be added twice to the same cart', async () => {
    const h = setup({
      sku: skuRow({ price: 0, products: { id: 'p-free', name: 'Almet', claim_rule: 'salut_sem1_once' } }),
      user: { salut_approved_at: new Date().toISOString(), current_semester: 1 },
      select: selectChain([{ id: 'existing-line' }]),
    });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Almet gratis sudah ada di keranjang');
    assert.equal(h.calls.insert.length, 0);
  });

  test('an eligible member gets exactly one free almet regardless of the quantity asked for', async () => {
    const h = setup({
      sku: skuRow({ price: 0, products: { id: 'p-free', name: 'Almet', claim_rule: 'salut_sem1_once' } }),
      user: { salut_approved_at: new Date().toISOString(), current_semester: 1 },
    });
    const res = await authed('post', '/api/cart/merch').send({ skuId: SKU_ID, quantity: 5 });
    assert.equal(res.status, 201);
    assert.equal(h.calls.values[0].quantity, 1);
    assert.equal(h.calls.values[0].price_snapshot, 0);
  });
});
