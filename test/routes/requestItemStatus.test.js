'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, updateChain, selectChain } = require('../helpers/testApp');

const ADMIN = { id: 'admin-1', role: 'admin' };
const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';

function adminOrderRow(over = {}) {
  return {
    id: ORDER_ID,
    order_number: 'UT-2026-0001',
    status: 'pending',
    subtotal: 100000,
    shipping_cost: 300000,
    box_fee: 100000,
    admin_fee: 25000,
    is_salut_order: false,
    total_amount: 525000,
    created_at: '2026-05-20T06:30:00Z',
    shipping_name: 'Andi',
    shipping_phone: '+886912345678',
    payments: [{ status: 'pending', amount: 525425, proof_path: null, invoice_path: null, proof_uploaded_at: null }],
    order_items: [
      { id: ITEM_ID, module_code: 'MKDU4109', module_name: 'Bahasa Inggris', quantity: 2,
        unit_price: 50000, subtotal: 100000, is_request: true, request_status: 'approved', sku_id: null, variant_label: null },
    ],
    ...over,
  };
}

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ existingItem, orderRow = adminOrderRow(), remaining = 5 } = {}) {
  harness = stubBackend({
    user: ADMIN,
    query: {
      order_items: { findFirst: async () => existingItem },
      orders: { findFirst: async () => orderRow },
      users: { findFirst: async () => ({ email: 'andi@example.com', name: 'Andi' }) },
    },
    update: updateChain([{ id: ITEM_ID, subtotal: 100000 }]),
    select: selectChain([{ remaining, pending: 0 }]),
  });
  return harness;
}

describe('PATCH /api/orders/admin/:orderId/items/:itemId/request-status', () => {
  test('approving with a price returns the whole refreshed order', async () => {
    setup({ existingItem: { id: ITEM_ID, quantity: 2, unit_price: 0, is_request: true } });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved', unit_price: 50000 });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'approved');
    assert.equal(res.body.order.id, ORDER_ID);
    // Presented, not raw — the admin table renders these directly.
    assert.ok(res.body.order.total_amount_display);
    assert.equal(res.body.order.order_kind, 'module');
  });

  test('approving a still-unpriced item without a price is rejected', async () => {
    setup({ existingItem: { id: ITEM_ID, quantity: 2, unit_price: 0, is_request: true } });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Masukkan harga untuk item ini sebelum menyetujui');
  });

  test('approving an already-priced item needs no price', async () => {
    setup({ existingItem: { id: ITEM_ID, quantity: 2, unit_price: 50000, is_request: true } });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved' });

    assert.equal(res.status, 200);
    assert.ok(res.body.order);
  });

  test('a non-request item cannot be approved', async () => {
    setup({ existingItem: { id: ITEM_ID, quantity: 1, unit_price: 350000, is_request: false } });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Hanya item permintaan yang bisa disetujui');
  });

  test('rejecting the last remaining item is refused', async () => {
    setup({ existingItem: { id: ITEM_ID, quantity: 1, unit_price: 0, is_request: true }, remaining: 1 });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'rejected' });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Tidak dapat menolak semua item/);
  });

  test('a merch order comes back tagged as merch', async () => {
    setup({
      existingItem: { id: ITEM_ID, quantity: 1, unit_price: 0, is_request: true },
      orderRow: adminOrderRow({
        order_items: [{ id: ITEM_ID, module_code: null, module_name: 'Jas Almamater', quantity: 1,
          unit_price: 350000, subtotal: 350000, is_request: false, request_status: null, sku_id: 'sku-1', variant_label: 'L' }],
      }),
    });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved', unit_price: 350000 });

    assert.equal(res.status, 200);
    assert.equal(res.body.order.order_kind, 'merch');
    assert.equal(res.body.order.order_items[0].item_type, 'merch');
  });

  test('a non-admin cannot resolve request items', async () => {
    harness = stubBackend({ user: { id: 'u-1', role: 'student' }, query: {} });

    const res = await request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved', unit_price: 50000 });

    assert.equal(res.status, 403);
  });
});

describe('POST /api/orders/admin/:orderId/confirm-karunika', () => {
  test('blocked while a request item is still pending', async () => {
    harness = stubBackend({ user: ADMIN, query: {}, select: selectChain([{ pending: 1 }]) });

    const res = await request(app)
      .post(`/api/orders/admin/${ORDER_ID}/confirm-karunika`)
      .set('Authorization', 'Bearer test-token');

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Selesaikan semua permintaan/);
  });

  test('proceeds once nothing is pending — merch no longer blocks it', async () => {
    harness = stubBackend({
      user: ADMIN,
      query: { orders: { findFirst: async () => adminOrderRow() }, users: { findFirst: async () => null } },
      select: selectChain([{ pending: 0 }]),
      update: updateChain([{ id: ORDER_ID }]),
    });

    const res = await request(app)
      .post(`/api/orders/admin/${ORDER_ID}/confirm-karunika`)
      .set('Authorization', 'Bearer test-token');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'awaiting_payment');
  });
});

describe('telling the student once every requested item is settled', () => {
  // Students request modules that have no price yet. Emailing on each decision
  // would mean four emails for a four-item request, so the summary is sent
  // only when the last pending one is settled.
  const { selectQueue, freshIp } = require('../helpers/testApp');

  function resolveSetup({ remaining = 0, items, order = { order_number: 'UT-2026-0001', user_id: 'u-1' }, user = { email: 'andi@example.com', name: 'Andi' } } = {}) {
    const requested = items ?? [
      { module_name: 'Bahasa Inggris', request_status: 'approved' },
      { module_name: 'Statistika', request_status: 'rejected' },
    ];
    harness = stubBackend({
      user: ADMIN,
      query: {
        order_items: { findFirst: async () => ({ id: ITEM_ID, quantity: 1, unit_price: 0, is_request: true }) },
        orders: { findFirst: async () => order },
        users: { findFirst: async () => user },
      },
      update: updateChain([{ id: ITEM_ID, subtotal: 50000 }]),
      // The recalculation runs through db.execute, so the only two selects are
      // the still-pending count and then the settled items.
      select: selectQueue([
        [{ remaining, pending: 0 }],
        requested,
      ]),
    });
    return harness;
  }

  const settle = () =>
    request(app)
      .patch(`/api/orders/admin/${ORDER_ID}/items/${ITEM_ID}/request-status`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', 'Bearer test-token')
      .send({ status: 'approved', unit_price: 50000 });

  test('the summary lists what was approved and what was turned down', async () => {
    const h = resolveSetup();

    await settle();

    const payload = await h.email.next('sendRequestItemsResolved');
    assert.equal(payload.email, 'andi@example.com');
    assert.equal(payload.orderNumber, 'UT-2026-0001');
    assert.deepEqual(payload.approved, ['Bahasa Inggris']);
    assert.deepEqual(payload.rejected, ['Statistika']);
  });

  test('nothing is sent while other items are still waiting on an admin', async () => {
    const h = resolveSetup({ remaining: 2 });

    await settle();

    await assert.rejects(
      h.email.next('sendRequestItemsResolved'),
      'the student must not be emailed until the last item is settled',
    );
  });

  test('an order that vanished mid-decision sends nothing rather than throwing', async () => {
    const h = resolveSetup({ order: null });

    const res = await settle();

    assert.equal(res.status, 200, 'the admin still gets their answer');
    await assert.rejects(h.email.next('sendRequestItemsResolved'));
  });

  test('a missing user record sends nothing rather than emailing undefined', async () => {
    const h = resolveSetup({ user: null });

    const res = await settle();

    assert.equal(res.status, 200);
    await assert.rejects(h.email.next('sendRequestItemsResolved'));
  });

  test('an all-approved request reports nothing as rejected', async () => {
    const h = resolveSetup({
      items: [
        { module_name: 'Bahasa Inggris', request_status: 'approved' },
        { module_name: 'Statistika', request_status: 'approved' },
      ],
    });

    await settle();

    const payload = await h.email.next('sendRequestItemsResolved');
    assert.deepEqual(payload.approved, ['Bahasa Inggris', 'Statistika']);
    assert.deepEqual(payload.rejected, []);
  });

  test('the email is fire-and-forget — a mail failure never fails the admin action', async () => {
    const h = resolveSetup();
    h.email.failNext('sendRequestItemsResolved');

    const res = await settle();

    assert.equal(res.status, 200);
    // And the rejection was handled: the cross-cutting suite fails the run on
    // any unhandled one, so reaching here with the mail rejected is the proof.
    await h.email.next('sendRequestItemsResolved');
  });
});
