'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, adminUser, freshIp } = require('../helpers/testApp');

// Express 4 does not catch rejections from async handlers. Before
// utils/asyncHandler.js, a database blip inside checkout sent NO response at
// all — the client hung until its socket timed out — and emitted an unhandled
// rejection that can terminate the process. These tests hold that fix in place.

const BOOM = () => { throw new Error('database is on fire'); };

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function get(path) {
  return request(app).get(path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');
}
function post(path) {
  return request(app).post(path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');
}

describe('async handler rejections become 500 responses', () => {
  test('a throwing query in checkout answers 500 instead of hanging', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { carts: { findFirst: BOOM } },
    });

    const res = await post('/api/orders/checkout').send({
      shippingName: 'Andi', shippingAddress: 'Jl. 1', shippingCity: 'Taipei',
      shippingProvince: 'Taiwan', shippingPostal: '10001', shippingPhone: '+886912345678',
      paymentMethod: 'transfer',
    });

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'database is on fire');
  });

  test('the rejection is handled, not left unhandled', async () => {
    harness = stubBackend({ user: studentUser(), query: { carts: { findFirst: BOOM } } });

    await post('/api/orders/checkout').send({
      shippingName: 'Andi', shippingAddress: 'Jl. 1', shippingCity: 'Taipei',
      shippingProvince: 'Taiwan', shippingPostal: '10001', shippingPhone: '+886912345678',
      paymentMethod: 'transfer',
    });
    // Give any stray rejection a tick to surface.
    await new Promise(r => setImmediate(r));

    assert.deepEqual(harness.unhandled, []);
  });

  test('a throwing order lookup answers 500', async () => {
    harness = stubBackend({ user: studentUser(), query: { orders: { findFirst: BOOM } } });

    const res = await get('/api/orders/11111111-1111-1111-1111-111111111111');

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'database is on fire');
  });

  test('a throwing cancel answers 500 rather than stranding the request', async () => {
    harness = stubBackend({
      user: studentUser(),
      rpc: () => { throw new Error('rpc unreachable'); },
    });

    const res = await post('/api/orders/11111111-1111-1111-1111-111111111111/cancel');

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'rpc unreachable');
  });

  test('a throwing payment confirmation answers 500', async () => {
    harness = stubBackend({
      user: adminUser(),
      rpc: () => { throw new Error('rpc unreachable'); },
    });

    const res = await post('/api/payments/11111111-1111-1111-1111-111111111111/confirm');

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'rpc unreachable');
  });

  test('the 500 body carries no stack outside development', async () => {
    harness = stubBackend({ user: studentUser(), query: { orders: { findFirst: BOOM } } });

    const res = await get('/api/orders/11111111-1111-1111-1111-111111111111');

    assert.equal(res.body.stack, undefined);
  });
});
