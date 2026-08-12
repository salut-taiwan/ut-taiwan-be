'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, updateChain, freshIp } = require('../helpers/testApp');
const { supabase } = require('../../config/supabase');

// Driven over HTTP through a route that needs nothing but auth.
const ROUTE = '/api/salut/status';

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

const req = () => request(app).get(ROUTE).set('X-Forwarded-For', freshIp());

function setup(over = {}) {
  harness = stubBackend({
    user: studentUser(),
    query: { users: { findFirst: async () => ({ salut_status: 'none', is_salut: false }) } },
    ...over,
  });
  return harness;
}

describe('authMiddleware — rejection', () => {
  test('a request with no Authorization header is refused', async () => {
    setup();
    const res = await req();
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Missing or invalid authorization header');
  });

  test('a non-Bearer scheme is refused', async () => {
    setup();
    const res = await req().set('Authorization', 'Basic abc123');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Missing or invalid authorization header');
  });

  test('a token Supabase rejects is refused, without leaking why', async () => {
    setup({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: 'jwt expired' } }) },
    });
    const res = await req().set('Authorization', 'Bearer stale');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid or expired token');
  });

  test('a response with neither user nor error is still refused', async () => {
    setup({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    const res = await req().set('Authorization', 'Bearer weird');
    assert.equal(res.status, 401);
  });
});

describe('authMiddleware — acceptance and the verification heal', () => {
  test('a valid token reaches the handler', async () => {
    setup();
    const res = await req().set('Authorization', 'Bearer good');
    assert.equal(res.status, 200);
  });

  test('the bearer token is what gets verified', async () => {
    const h = setup();
    await req().set('Authorization', 'Bearer the-actual-token');
    assert.equal(h.calls.auth[0].token, 'the-actual-token');
  });

  test('a confirmed email heals a stale is_verified flag', async () => {
    // Supabase owns confirmation; our column mirrors it and can lag.
    const h = setup({ update: updateChain([{ id: 'u-1' }]) });
    await req().set('Authorization', 'Bearer good');
    assert.deepEqual(h.calls.authHeal, [{ is_verified: true }]);
  });

  test('an unconfirmed email writes nothing', async () => {
    const h = setup({ user: studentUser({ email_confirmed_at: null }) });
    await req().set('Authorization', 'Bearer good');
    assert.deepEqual(h.calls.authHeal, []);
  });

  test('a failed heal never breaks the request', async () => {
    const h = setup({ update: () => { throw new Error('write failed'); } });
    const res = await req().set('Authorization', 'Bearer good');
    assert.equal(res.status, 200);
    assert.deepEqual(h.unhandled, []);
  });
});

describe('authenticateSSE', () => {
  test('the token comes from the query string — EventSource cannot set headers', async () => {
    setup();
    const res = await request(app)
      .get('/api/sse/status')
      .set('X-Forwarded-For', freshIp());
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
  });

  test('an invalid query token is refused', async () => {
    setup({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: 'bad' } }) },
    });
    const res = await request(app)
      .get('/api/sse/status?token=stale')
      .set('X-Forwarded-For', freshIp());
    assert.equal(res.status, 401);
  });
});
