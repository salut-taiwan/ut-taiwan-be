'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, freshIp } = require('../helpers/testApp');

// GET /api/products/:id/claim-cta drives the button on a claim-gated product.
// Five states, and the precedence between them is the rule that matters.

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const pgResult = (rows = []) => Object.assign([...rows], { count: rows.length });

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ product, user: userRow, claimed = [], anonymous = false } = {}) {
  harness = stubBackend({
    user: studentUser(),
    query: {
      products: { findFirst: async () => product },
      users: { findFirst: async () => userRow },
    },
    execute: async () => pgResult(claimed),
    ...(anonymous
      ? { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'invalid token' } }) } }
      : {}),
  });
  return harness;
}

const gated = { id: PRODUCT_ID, claim_rule: 'salut_sem1_once' };
const activeSem1 = { current_semester: 1, salut_approved_at: new Date().toISOString() };

function get({ anonymous = false } = {}) {
  const req = request(app).get(`/api/products/${PRODUCT_ID}/claim-cta`).set('X-Forwarded-For', freshIp());
  return anonymous ? req : req.set('Authorization', 'Bearer t');
}

describe('GET /api/products/:id/claim-cta', () => {
  test('an unknown product is a 404', async () => {
    setup({ product: undefined });
    const res = await get();
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Produk tidak ditemukan');
  });

  test('a product without a claim rule has no claim CTA at all', async () => {
    setup({ product: { id: PRODUCT_ID, claim_rule: null } });
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.body.claim_cta, null);
  });

  test('the response is never cached — the CTA is per-user state', async () => {
    setup({ product: gated, user: activeSem1 });
    const res = await get();
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('even the 404 carries no-store', async () => {
    setup({ product: undefined });
    const res = await get();
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('an anonymous visitor is asked to log in, and is sent back to the product', async () => {
    setup({ product: gated, anonymous: true });
    const res = await get({ anonymous: true });
    assert.equal(res.body.claim_cta.state, 'need_login');
    assert.equal(res.body.claim_cta.href, `/login?redirect=/toko/${PRODUCT_ID}`);
    assert.equal(res.body.claim_cta.disabled, false);
  });

  test('a member who already claimed sees a disabled button', async () => {
    setup({ product: gated, user: activeSem1, claimed: [{ '?column?': 1 }] });
    const res = await get();
    assert.equal(res.body.claim_cta.state, 'already_claimed');
    assert.equal(res.body.claim_cta.disabled, true);
  });

  test('already-claimed wins over every other state — it is checked first', async () => {
    // A lapsed, semester-5 member who already claimed must still read as claimed,
    // and the user row is never even consulted.
    const h = setup({
      product: gated,
      user: { current_semester: 5, salut_approved_at: null },
      claimed: [{ '?column?': 1 }],
    });
    const res = await get();
    assert.equal(res.body.claim_cta.state, 'already_claimed');
    assert.equal(h.calls.execute.length, 1);
  });

  test('a non-member is pointed at SALUT registration', async () => {
    setup({ product: gated, user: { current_semester: 1, salut_approved_at: null } });
    const res = await get();
    assert.equal(res.body.claim_cta.state, 'need_salut');
    assert.equal(res.body.claim_cta.href, '/salut');
    assert.equal(res.body.claim_cta.disabled, false);
  });

  test('a member past semester 1 is told the offer is not for them', async () => {
    setup({
      product: gated,
      user: { current_semester: 3, salut_approved_at: new Date().toISOString() },
    });
    const res = await get();
    assert.equal(res.body.claim_cta.state, 'not_sem1');
    assert.equal(res.body.claim_cta.disabled, true);
  });

  test('an eligible member gets an add-to-cart claim button', async () => {
    setup({ product: gated, user: activeSem1 });
    const res = await get();
    assert.deepEqual(res.body.claim_cta, {
      state: 'eligible',
      label: 'Klaim Gratis',
      addToCart: true,
      disabled: false,
    });
  });

  test('a logged-in user with no profile row is treated as a non-member', async () => {
    setup({ product: gated, user: undefined });
    const res = await get();
    assert.equal(res.body.claim_cta.state, 'need_salut');
  });

  test('a failing claim lookup surfaces as a 500 rather than a wrong CTA', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { products: { findFirst: async () => gated } },
      execute: async () => { throw new Error('db down'); },
    });
    const res = await get();
    assert.equal(res.status, 500);
  });
});
