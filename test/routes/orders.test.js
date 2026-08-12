'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, updateChain, selectChain, freshIp,
} = require('../helpers/testApp');
const { PAYMENT_BANK } = require('../../config/constants');

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

const orderRow = (over = {}) => ({
  id: ORDER_ID,
  order_number: 'UT-2026-10000',
  status: 'awaiting_payment',
  subtotal: 100000,
  shipping_cost: 300000,
  box_fee: 100000,
  admin_fee: 25000,
  is_salut_order: false,
  total_amount: 525000,
  created_at: '2026-05-20T06:30:00Z',
  shipping_name: 'Andi',
  shipping_phone: '+886912345678',
  order_items: [],
  payments: [],
  ...over,
});

const item = (over = {}) => ({
  id: 'oi-1', module_code: 'MKDU4109', module_name: 'Bahasa Inggris',
  quantity: 2, unit_price: 50000, subtotal: 100000,
  is_request: false, request_status: null, sku_id: null, variant_label: null,
  ...over,
});

const payment = (over = {}) => ({
  id: 'pay-1', status: 'pending', amount: 525425, unique_code: 425,
  expires_at: '2026-05-25T17:00:00Z', paid_at: null, proof_path: null,
  invoice_path: null, proof_uploaded_at: null, created_at: '2026-05-20T06:30:00Z',
  ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  user = studentUser(),
  order = orderRow(),
  orders: list = [orderRow()],
  counts = [{ pending: 0, remaining: 5 }],
  existingItem,
  update,
  rpc,
} = {}) {
  harness = stubBackend({
    user,
    query: {
      orders: { findFirst: async () => order, findMany: async () => list },
      order_items: { findFirst: async () => existingItem },
      users: { findFirst: async () => ({ email: 'a@b.c', name: 'Andi' }) },
    },
    select: selectChain(counts),
    update: update ?? updateChain([{ id: ORDER_ID }]),
    rpc,
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('GET /api/orders', () => {
  test('a student sees their own orders with display fields', async () => {
    setup();
    const res = await authed('get', '/api/orders');
    assert.equal(res.status, 200);
    assert.equal(res.body[0].order_number, 'UT-2026-10000');
    assert.ok(res.body[0].total_amount_display);
    assert.ok(res.body[0].status_label);
  });

  test('an empty history is an empty list, not an error', async () => {
    setup({ orders: [] });
    const res = await authed('get', '/api/orders');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('an anonymous request is refused', async () => {
    setup();
    const res = await request(app).get('/api/orders').set('X-Forwarded-For', freshIp());
    assert.equal(res.status, 401);
  });
});

describe('GET /api/orders/:id', () => {
  test('another user\'s order is a 404', async () => {
    setup({ order: null });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Pesanan tidak ditemukan');
  });

  test('bank details appear only while payment is actually due', async () => {
    setup({ order: orderRow({ payments: [payment()] }) });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    const p = res.body.payments[0];
    assert.equal(p.show_payment_instructions, true);
    assert.equal(p.bank_name, PAYMENT_BANK.bank);
    assert.equal(p.bank_account, PAYMENT_BANK.account);
  });

  test('a paid order no longer shows where to transfer', async () => {
    setup({ order: orderRow({ status: 'paid', payments: [payment({ status: 'paid' })] }) });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    const p = res.body.payments[0];
    assert.equal(p.show_payment_instructions, false);
    assert.equal(p.bank_account, undefined);
  });

  test('an order still awaiting stock confirmation hides the deadline', async () => {
    setup({ order: orderRow({ status: 'pending', payments: [payment()] }) });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    assert.equal(res.body.payments[0].show_payment_deadline, false);
  });

  test('a rejected item is marked so the UI can strike it through', async () => {
    setup({
      order: orderRow({
        order_items: [item({ is_request: true, request_status: 'rejected' })],
      }),
    });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    assert.equal(res.body.order_items[0].display_status, 'rejected');
    assert.equal(res.body.order_items[0].price_visible, false);
  });

  test('a request still awaiting a price hides the zero rather than promising "Gratis"', async () => {
    setup({
      order: orderRow({
        order_items: [item({ is_request: true, request_status: 'pending', unit_price: 0, subtotal: 0 })],
      }),
    });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    assert.equal(res.body.order_items[0].display_status, 'pending_request');
    assert.equal(res.body.order_items[0].price_visible, false);
  });

  test('a genuinely free item shows as free', async () => {
    setup({
      order: orderRow({
        order_items: [item({ sku_id: 'sku-free', module_code: null, unit_price: 0, subtotal: 0 })],
      }),
    });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    const [row] = res.body.order_items;
    assert.equal(row.display_status, 'normal');
    assert.equal(row.subtotal_display, 'Gratis');
    assert.equal(row.item_type, 'merch');
  });

  test('a normally priced item shows its amount', async () => {
    setup({ order: orderRow({ order_items: [item()] }) });
    const res = await authed('get', `/api/orders/${ORDER_ID}`);
    assert.equal(res.body.order_items[0].display_status, 'normal');
    assert.equal(res.body.order_items[0].price_visible, true);
  });
});

describe('POST /api/orders/:id/cancel', () => {
  test('a successful cancellation reports back', async () => {
    setup({ rpc: () => ({ data: true, error: null }) });
    const res = await authed('post', `/api/orders/${ORDER_ID}/cancel`);
    assert.equal(res.status, 200);
    assert.match(res.body.message, /dibatalkan/);
  });

  test('an order that is not the caller\'s is a 404', async () => {
    setup({ rpc: () => ({ data: null, error: { message: 'Pesanan tidak ditemukan' } }) });
    const res = await authed('post', `/api/orders/${ORDER_ID}/cancel`);
    assert.equal(res.status, 404);
  });

  test('an order past the cancellable stage is a 400', async () => {
    setup({
      rpc: () => ({ data: null, error: { message: 'Hanya pesanan pending yang dapat dibatalkan' } }),
    });
    const res = await authed('post', `/api/orders/${ORDER_ID}/cancel`);
    assert.equal(res.status, 400);
  });
});

describe('POST /api/orders/:id/confirm-delivery', () => {
  test('a shipped order can be marked received', async () => {
    setup();
    const res = await authed('post', `/api/orders/${ORDER_ID}/confirm-delivery`);
    assert.equal(res.status, 200);
  });

  test('an order that is not shipped cannot be confirmed', async () => {
    setup({ update: updateChain([]) });
    const res = await authed('post', `/api/orders/${ORDER_ID}/confirm-delivery`);
    assert.equal(res.status, 400);
  });
});

describe('PATCH /api/orders/admin/:orderId/status', () => {
  test('a student cannot move an order along', async () => {
    setup({ user: studentUser() });
    const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: 'paid' });
    assert.equal(res.status, 403);
  });

  test('the status is required', async () => {
    setup({ user: adminUser() });
    const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({});
    assert.equal(res.status, 400);
  });

  test('an unknown order is a 404', async () => {
    setup({ user: adminUser(), order: null });
    const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: 'paid' });
    assert.equal(res.status, 404);
  });

  test('each legal transition is allowed', async () => {
    const legal = [
      ['pending', 'awaiting_payment'],
      ['awaiting_payment', 'paid'],
      ['paid', 'processing'],
      ['paid', 'shipped'],
      ['processing', 'shipped'],
      ['shipped', 'delivered'],
    ];
    for (const [from, to] of legal) {
      setup({ user: adminUser(), order: { id: ORDER_ID, status: from } });
      const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: to });
      assert.equal(res.status, 200, `${from} → ${to} should be allowed`);
      harness.restore();
      harness = null;
    }
  });

  test('an illegal transition is refused and names both states', async () => {
    const illegal = [
      ['pending', 'paid'],
      ['pending', 'shipped'],
      ['awaiting_payment', 'delivered'],
      ['delivered', 'shipped'],
      ['cancelled', 'paid'],
    ];
    for (const [from, to] of illegal) {
      setup({ user: adminUser(), order: { id: ORDER_ID, status: from } });
      const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: to });
      assert.equal(res.status, 400, `${from} → ${to} should be refused`);
      assert.match(res.body.error, new RegExp(from));
      harness.restore();
      harness = null;
    }
  });

  test('a payment can never be recorded before stock is confirmed', async () => {
    setup({ user: adminUser(), order: { id: ORDER_ID, status: 'pending' } });
    const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: 'paid' });
    assert.equal(res.status, 400);
  });

  test('shipping stamps the dispatch time', async () => {
    const h = setup({ user: adminUser(), order: { id: ORDER_ID, status: 'processing' } });
    await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: 'shipped' });
    assert.ok(h.calls.set[0].shipped_at instanceof Date);
  });

  test('a concurrent update is reported as a conflict, not silently lost', async () => {
    // The update is conditional on the status we read; zero rows means someone
    // else moved the order first.
    setup({ user: adminUser(), order: { id: ORDER_ID, status: 'paid' }, update: updateChain([]) });
    const res = await authed('patch', `/api/orders/admin/${ORDER_ID}/status`).send({ status: 'shipped' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /silakan refresh/);
  });
});

describe('GET /api/orders/admin/all', () => {
  test('a student cannot list every order', async () => {
    setup({ user: studentUser() });
    const res = await authed('get', '/api/orders/admin/all');
    assert.equal(res.status, 403);
  });

  test('an admin sees orders tagged by what they contain', async () => {
    setup({
      user: adminUser(),
      orders: [
        orderRow({ order_items: [item()] }),
        orderRow({ id: 'o-2', order_items: [item({ sku_id: 'sku-1', module_code: null })] }),
        orderRow({ id: 'o-3', order_items: [item(), item({ id: 'oi-2', sku_id: 'sku-1', module_code: null })] }),
      ],
    });
    const res = await authed('get', '/api/orders/admin/all');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(o => o.order_kind), ['module', 'merch', 'mixed']);
  });
});

describe('POST /api/orders/admin/:orderId/confirm-karunika', () => {
  test('an order with unresolved requests cannot advance', async () => {
    setup({ user: adminUser(), counts: [{ pending: 2 }] });
    const res = await authed('post', `/api/orders/admin/${ORDER_ID}/confirm-karunika`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Selesaikan semua permintaan/);
  });

  test('once everything is resolved the order moves to awaiting payment', async () => {
    setup({ user: adminUser(), counts: [{ pending: 0 }] });
    const res = await authed('post', `/api/orders/admin/${ORDER_ID}/confirm-karunika`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'awaiting_payment');
  });

  test('an order not in the pending stage is refused', async () => {
    setup({ user: adminUser(), counts: [{ pending: 0 }], update: updateChain([]) });
    const res = await authed('post', `/api/orders/admin/${ORDER_ID}/confirm-karunika`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /bukan dalam status pending/);
  });

  test('the customer is told how to pay', async () => {
    const h = setup({ user: adminUser(), counts: [{ pending: 0 }] });
    await authed('post', `/api/orders/admin/${ORDER_ID}/confirm-karunika`);
    const payload = await h.email.next('sendPaymentRequest');
    assert.ok(payload.expiresAt, 'the email must carry a deadline');
  });
});
