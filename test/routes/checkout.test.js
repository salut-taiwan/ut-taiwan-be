'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, selectChain, freshIp,
} = require('../helpers/testApp');
const paymentService = require('../../services/paymentService');
const { SALUT_FEES } = require('../../config/constants');

// POST /api/orders/checkout — the money endpoint. Everything the controller
// decides before handing off to the checkout_order RPC is assertable here; the
// RPC body itself belongs to the system tier.

const CART_ID = '11111111-1111-1111-1111-111111111111';
const ORDER_ID = '33333333-3333-3333-3333-333333333333';

const ADDRESS = {
  shippingName: 'Andi',
  shippingAddress: 'Jl. Uji 1',
  shippingCity: 'Taipei',
  shippingProvince: 'Taiwan',
  shippingPostal: '10001',
  shippingPhone: '+886912345678',
  paymentMethod: 'transfer',
};

const moduleLine = (over = {}) => ({
  quantity: 2,
  price_snapshot: 50000,
  is_request: false,
  modules: { id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris', is_available: true },
  ...over,
});

const merchLine = (over = {}) => ({
  quantity: 1,
  price_snapshot: 350000,
  is_request: false,
  sku_id: 'sku-1',
  variant_label: 'L',
  product_name_snapshot: 'Jas Almamater',
  product_skus: { id: 'sku-1', price: 350000, products: { id: 'prod-1', name: 'Jas', claim_rule: null } },
  ...over,
});

const rpcOk = () => ({
  data: { order: { id: ORDER_ID, order_number: 'UT-2026-10000' }, payment: { id: 'pay-1' } },
  error: null,
});

const pgResult = (rows = []) => Object.assign([...rows], { count: rows.length });

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  cart = { id: CART_ID },
  items = [moduleLine()],
  user: userRow = { is_salut: false, salut_approved_at: null, current_semester: 3 },
  rpc = rpcOk,
  random,
  claimed = [],
} = {}) {
  harness = stubBackend({
    user: studentUser(),
    random,
    query: {
      carts: { findFirst: async () => cart },
      cart_items: { findMany: async () => items },
      users: { findFirst: async () => userRow },
    },
    execute: async () => pgResult(claimed),
    select: selectChain([{ count: 0 }]),
    rpc,
  });
  return harness;
}

const post = (body = ADDRESS) =>
  request(app).post('/api/orders/checkout')
    .set('X-Forwarded-For', freshIp())
    .set('Authorization', 'Bearer t')
    .send(body);

/** The p_* parameters handed to checkout_order. */
const rpcParams = (h) => h.calls.rpc.find(c => c.fn === 'checkout_order')?.params;

describe('checkout — required fields', () => {
  for (const field of Object.keys(ADDRESS)) {
    test(`${field} is required`, async () => {
      setup();
      const res = await post({ ...ADDRESS, [field]: undefined });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, `${field} wajib diisi`);
    });
  }

  test('an empty string counts as missing', async () => {
    setup();
    const res = await post({ ...ADDRESS, shippingName: '' });
    assert.equal(res.status, 400);
  });

  test('nothing is charged when validation fails', async () => {
    const h = setup();
    await post({ ...ADDRESS, shippingPhone: undefined });
    assert.equal(h.calls.rpc.length, 0);
  });
});

describe('checkout — address precedence', () => {
  test('structured Mandarin fields compose the address and win over the flat ones', async () => {
    const h = setup();
    await post({
      ...ADDRESS,
      shipping_name: 'Budi',
      shipping_zh_road: '羅斯福路',
      shipping_zh_number: '1號',
      shipping_zh_floor: '5樓',
      shipping_zh_city: '台北市',
      shipping_zh_district: '中正區',
      shipping_postal: '10617',
      shipping_phone: '+886900000000',
    });

    const p = rpcParams(h);
    assert.equal(p.p_shipping_name, 'Budi');
    assert.equal(p.p_shipping_city, '中正區台北市');
    assert.equal(p.p_shipping_postal, '10617');
    assert.equal(p.p_shipping_phone, '+886900000000');
    assert.ok(p.p_shipping_address.includes('羅斯福路'));
  });

  test('the flat fields are used when no structured address is supplied', async () => {
    const h = setup();
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_shipping_address, 'Jl. Uji 1');
    assert.equal(p.p_shipping_city, 'Taipei');
  });

  test('province has no structured equivalent, so it is still required', async () => {
    setup();
    const res = await post({
      ...ADDRESS,
      shippingProvince: undefined,
      shipping_name: 'Budi',
      shipping_zh_road: '羅斯福路',
      shipping_zh_city: '台北市',
      shipping_postal: '10617',
      shipping_phone: '+886900000000',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'shippingProvince wajib diisi');
  });

  test('the country defaults to Taiwan and notes default to null', async () => {
    const h = setup();
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_shipping_country, 'Taiwan');
    assert.equal(p.p_notes, null);
  });
});

describe('checkout — cart preconditions', () => {
  test('a user with no cart cannot check out', async () => {
    setup({ cart: null });
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Keranjang kosong');
  });

  test('an empty cart cannot check out', async () => {
    setup({ items: [] });
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Keranjang kosong');
  });

  test('an out-of-stock module blocks checkout and names the code', async () => {
    setup({
      items: [moduleLine({
        modules: { id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris', is_available: false },
      })],
    });
    const res = await post();
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.modules, ['MKDU4109']);
  });

  test('every out-of-stock code is reported, not just the first', async () => {
    setup({
      items: [
        moduleLine({ modules: { id: 'm-1', tbo_code: 'AAA1111', name: 'A', is_available: false } }),
        moduleLine({ modules: { id: 'm-2', tbo_code: 'BBB2222', name: 'B', is_available: false } }),
      ],
    });
    const res = await post();
    assert.deepEqual(res.body.modules, ['AAA1111', 'BBB2222']);
  });

  test('an out-of-stock module already marked as a request does not block', async () => {
    setup({
      items: [moduleLine({
        is_request: true,
        modules: { id: 'm-1', tbo_code: 'MKDU4109', name: 'B', is_available: false },
      })],
    });
    const res = await post();
    assert.equal(res.status, 201);
  });

  test('merchandise is never blocked by module availability', async () => {
    setup({ items: [merchLine()] });
    const res = await post();
    assert.equal(res.status, 201);
  });
});

describe('checkout — SALUT fee waiver', () => {
  test('a non-member pays all three service fees', async () => {
    const h = setup();
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_shipping_cost, SALUT_FEES.ONGKIR);
    assert.equal(p.p_box_fee, SALUT_FEES.BOX);
    assert.equal(p.p_admin_fee, SALUT_FEES.ADMIN);
    assert.equal(p.p_is_salut_order, false);
    assert.equal(p.p_total_amount, 100000 + 300000 + 100000 + 25000);
  });

  test('an active member pays none of them', async () => {
    const h = setup({
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 3 },
    });
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_shipping_cost, 0);
    assert.equal(p.p_box_fee, 0);
    assert.equal(p.p_admin_fee, 0);
    assert.equal(p.p_is_salut_order, true);
    assert.equal(p.p_total_amount, 100000);
  });

  test('a lapsed membership does not waive — the flag alone is not enough', async () => {
    // is_salut can stay true after a cycle rolls over; only the approval date
    // decides. This is the whole point of the lazy-expiry rule.
    const h = setup({
      user: { is_salut: true, salut_approved_at: '2020-01-01T00:00:00Z', current_semester: 3 },
    });
    await post();
    assert.equal(rpcParams(h).p_is_salut_order, false);
    assert.equal(rpcParams(h).p_shipping_cost, SALUT_FEES.ONGKIR);
  });

  test('a recent approval without the flag does not waive either', async () => {
    const h = setup({
      user: { is_salut: false, salut_approved_at: new Date().toISOString(), current_semester: 3 },
    });
    await post();
    assert.equal(rpcParams(h).p_is_salut_order, false);
  });

  test('a missing profile row falls back to charging full fees', async () => {
    const h = setup({ user: undefined });
    await post();
    assert.equal(rpcParams(h).p_is_salut_order, false);
  });
});

describe('checkout — amounts', () => {
  test('the subtotal is price times quantity, summed across lines', async () => {
    const h = setup({ items: [moduleLine(), merchLine()] });
    await post();
    assert.equal(rpcParams(h).p_subtotal, 100000 + 350000);
  });

  test('a numeric-string price snapshot is coerced, not concatenated', async () => {
    const h = setup({ items: [moduleLine({ price_snapshot: '50000.00' })] });
    await post();
    assert.equal(rpcParams(h).p_subtotal, 100000);
  });

  test('the payable amount is always the total plus the unique code', async () => {
    const h = setup();
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_payment_amount, p.p_total_amount + p.p_unique_code);
  });

  test('the unique code stays within the advertised 100–599 band', async () => {
    const h = setup();
    await post();
    const code = rpcParams(h).p_unique_code;
    assert.ok(code >= 100 && code <= 599, `${code} out of band`);
  });

  test('the lowest possible draw is 100', async () => {
    const h = setup({ random: 0 });
    await post();
    assert.equal(rpcParams(h).p_unique_code, 100);
  });

  test('the highest possible draw is 599', async () => {
    const h = setup({ random: 0.999999 });
    await post();
    assert.equal(rpcParams(h).p_unique_code, 599);
  });

  test('the order number follows the UT-<year>-<5 digits> format', async () => {
    const h = setup();
    await post();
    assert.match(rpcParams(h).p_order_number, /^UT-\d{4}-\d{5}$/);
  });

  test('a free order asks for nothing — no unique code, no amount', async () => {
    // A semester-1 member claiming the free almet has fees waived, so the
    // total is zero. Adding a unique code told them to transfer Rp 100-500 for
    // something free.
    const h = setup({
      items: [merchLine({ price_snapshot: 0 })],
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 1 },
    });

    await post();

    const p = rpcParams(h);
    assert.equal(p.p_total_amount, 0);
    assert.equal(p.p_unique_code, 0);
    assert.equal(p.p_payment_amount, 0);
  });

  test('an order that costs anything still gets a code to match the transfer', async () => {
    const h = setup({
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 1 },
    });

    await post();

    const p = rpcParams(h);
    assert.ok(p.p_total_amount > 0);
    assert.ok(p.p_unique_code >= 100 && p.p_unique_code <= 599);
  });

  test('a zero-total order still gets a payment row, so it can be completed', async () => {
    // confirm_payment refuses to advance an order with no pending payment, so
    // dropping the row would strand every free order.
    const h = setup({
      items: [merchLine({ price_snapshot: 0 })],
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 1 },
    });

    await post();

    const p = rpcParams(h);
    assert.equal(p.p_payment_method, 'transfer');
    assert.ok(p.p_payment_expires_at, 'the payment row is still created');
  });
});

describe('checkout — items payload', () => {
  test('a module line carries its code and name', async () => {
    const h = setup();
    await post();
    const [item] = rpcParams(h).p_order_items;
    assert.equal(item.module_code, 'MKDU4109');
    assert.equal(item.module_name, 'Bahasa Inggris');
    assert.equal(item.is_request, false);
  });

  test('a merch line carries its SKU and variant, with no module code', async () => {
    const h = setup({ items: [merchLine()] });
    await post();
    const [item] = rpcParams(h).p_order_items;
    assert.equal(item.sku_id, 'sku-1');
    assert.equal(item.variant_label, 'L');
    assert.equal(item.module_code, null);
    assert.equal(item.is_request, false);
  });

  test('custom items are appended after the cart lines and flagged as requests', async () => {
    const h = setup();
    await post({ ...ADDRESS, customItems: [{ moduleCode: ' EKMA4111 ', moduleName: 'Pengantar' }] });
    const items = rpcParams(h).p_order_items;
    assert.equal(items.length, 2);
    assert.equal(items[1].module_code, 'EKMA4111');
    assert.equal(items[1].is_request, true);
    assert.equal(items[1].unit_price, 0);
  });

  test('a custom item without a usable code is refused', async () => {
    setup();
    for (const bad of [undefined, '', '   ', 42, null]) {
      const res = await post({ ...ADDRESS, customItems: [{ moduleCode: bad }] });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
      assert.equal(res.body.error, 'Kode modul wajib diisi untuk setiap item tambahan');
    }
  });

  test('an invalid custom item is refused before any payment is arranged', async (t) => {
    // The validation used to run after chargeGateway, wasting the call.
    const charge = t.mock.method(paymentService, 'chargeGateway');
    setup();
    await post({ ...ADDRESS, customItems: [{ moduleCode: '   ' }] });
    assert.equal(charge.mock.callCount(), 0);
  });

  test('a non-array customItems value is ignored rather than fatal', async () => {
    const h = setup();
    const res = await post({ ...ADDRESS, customItems: 'nope' });
    assert.equal(res.status, 201);
    assert.equal(rpcParams(h).p_order_items.length, 1);
  });
});

describe('checkout — claim-gated items', () => {
  const claimLine = () => merchLine({
    price_snapshot: 0,
    product_skus: {
      id: 'sku-free', price: 0,
      products: { id: 'prod-free', name: 'Almet SALUT', claim_rule: 'salut_sem1_once' },
    },
  });

  test('an eligible member can check out the free almet', async () => {
    setup({
      items: [claimLine()],
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 1 },
    });
    const res = await post();
    assert.equal(res.status, 201);
  });

  test('a lapsed member is refused with the claim rule\'s own status and message', async () => {
    setup({
      items: [claimLine()],
      user: { is_salut: false, salut_approved_at: null, current_semester: 1 },
    });
    const res = await post();
    assert.equal(res.status, 403);
    assert.match(res.body.error, /anggota SALUT aktif/);
  });

  test('a member past semester 1 is refused', async () => {
    setup({
      items: [claimLine()],
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 4 },
    });
    const res = await post();
    assert.equal(res.status, 403);
    assert.match(res.body.error, /semester 1/);
  });

  test('a claim already spent is refused with 409, proving the status is proxied', async () => {
    setup({
      items: [claimLine()],
      user: { is_salut: true, salut_approved_at: new Date().toISOString(), current_semester: 1 },
      claimed: [{ '?column?': 1 }],
    });
    const res = await post();
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Almet gratis sudah pernah diklaim');
  });

  test('an ordinary product skips the eligibility check entirely', async () => {
    const h = setup({ items: [merchLine()] });
    await post();
    assert.equal(h.calls.execute.length, 0);
  });
});

describe('checkout — outcome', () => {
  test('success returns 201 with the order and payment the RPC created', async () => {
    setup();
    const res = await post();
    assert.equal(res.status, 201);
    assert.equal(res.body.order.id, ORDER_ID);
    assert.equal(res.body.payment.id, 'pay-1');
  });

  test('an out-of-stock race inside the transaction surfaces as a 400', async () => {
    // The RPC re-checks availability after locking the cart; the controller
    // recognises that failure by its message. This is a contract with the SQL.
    setup({ rpc: () => ({ data: null, error: { message: 'Modul tidak tersedia: MKDU4109' } }) });
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Modul tidak tersedia: MKDU4109');
  });

  test('any other RPC failure is a 500', async () => {
    setup({ rpc: () => ({ data: null, error: { message: 'deadlock detected' } }) });
    const res = await post();
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'deadlock detected');
  });

  test('a confirmation email is sent for the new order', async () => {
    const h = setup();
    await post();
    const payload = await h.email.next('fetchOrderEmailPayload');
    assert.equal(payload, ORDER_ID);
  });

  test('the gateway details are recorded with the payment', async () => {
    const h = setup();
    await post();
    const p = rpcParams(h);
    assert.equal(p.p_payment_gateway, 'manual');
    assert.equal(p.p_payment_method, 'transfer');
    assert.ok(p.p_payment_expires_at);
  });
});

describe('checkout — route guards', () => {
  test('an anonymous request is refused', async () => {
    setup();
    const res = await request(app).post('/api/orders/checkout')
      .set('X-Forwarded-For', freshIp()).send(ADDRESS);
    assert.equal(res.status, 401);
  });

  test('an unverified account cannot check out, and the cart is never read', async () => {
    const h = stubBackend({
      user: studentUser({ email_confirmed_at: null }),
      query: { carts: { findFirst: async () => { throw new Error('should not be reached'); } } },
    });
    harness = h;
    const res = await post();
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
  });
});
