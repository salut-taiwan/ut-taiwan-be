'use strict';

const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const adminOnly = require('../../middleware/adminOnly');
const { supabaseAdmin } = require('../../config/supabase');

// Called directly rather than over HTTP: the role cache needs clock control,
// and the middleware is baked into the router at app-require time.

const original = supabaseAdmin.from;
let lookups = 0;

function stubRole(role, { error = null } = {}) {
  lookups = 0;
  supabaseAdmin.from = () => ({
    select: () => ({
      eq: () => ({
        single: async () => {
          lookups += 1;
          return error ? { data: null, error } : { data: { role }, error: null };
        },
      }),
    }),
  });
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function run(user) {
  const res = fakeRes();
  let nexted = false;
  await adminOnly({ user }, res, () => { nexted = true; });
  return { res, nexted };
}

afterEach(() => { supabaseAdmin.from = original; mock.timers.reset(); });

describe('adminOnly', () => {
  test('an unauthenticated request is 401, not 403 — the distinction matters to the client', async () => {
    stubRole('admin');
    const { res, nexted } = await run(undefined);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Authentication required');
    assert.equal(nexted, false);
  });

  test('an admin passes', async () => {
    stubRole('admin');
    const { res, nexted } = await run({ id: randomUUID() });
    assert.equal(nexted, true);
    assert.equal(res.statusCode, null);
  });

  test('a student is refused', async () => {
    stubRole('student');
    const { res, nexted } = await run({ id: randomUUID() });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Admin access required');
  });

  test('a failed role lookup is refused with a distinct message', async () => {
    // "Access denied" means we could not establish the role; "Admin access
    // required" means we did and it was not admin.
    stubRole(null, { error: { message: 'db down' } });
    const { res } = await run({ id: randomUUID() });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Access denied');
  });

  test('a repeat request inside the window costs no database round trip', async () => {
    stubRole('admin');
    const user = { id: randomUUID() };
    await run(user);
    await run(user);
    await run(user);
    assert.equal(lookups, 1);
  });

  test('a cached refusal is also served without a round trip', async () => {
    stubRole('student');
    const user = { id: randomUUID() };
    const first = await run(user);
    const second = await run(user);
    assert.equal(first.res.statusCode, 403);
    assert.equal(second.res.statusCode, 403);
    assert.equal(lookups, 1);
  });

  test('each user is cached separately', async () => {
    stubRole('admin');
    await run({ id: randomUUID() });
    await run({ id: randomUUID() });
    assert.equal(lookups, 2);
  });

  test('the role is re-read once the five-minute window lapses', async (t) => {
    stubRole('admin');
    const user = { id: randomUUID() };
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-20T00:00:00Z') });

    await run(user);
    t.mock.timers.tick(5 * 60 * 1000 + 1);
    await run(user);

    assert.equal(lookups, 2);
  });

  test('a promotion takes up to five minutes to apply — known staleness, locked deliberately', async (t) => {
    // Anyone tempted to shorten or remove the cache should see this fail and
    // decide consciously. It is also why tests must never reuse a user id
    // across two roles in one file.
    const user = { id: randomUUID() };
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-20T00:00:00Z') });

    stubRole('student');
    const before = await run(user);
    assert.equal(before.res.statusCode, 403);

    stubRole('admin');
    t.mock.timers.tick(60 * 1000);
    const during = await run(user);
    assert.equal(during.res.statusCode, 403, 'still refused while the cache holds');

    t.mock.timers.tick(5 * 60 * 1000);
    const after = await run(user);
    assert.equal(after.nexted, true, 'allowed once the entry expires');
  });
});
