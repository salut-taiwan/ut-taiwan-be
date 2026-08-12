'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const optionalAuth = require('../../middleware/optionalAuth');
const { supabase } = require('../../config/supabase');

// Used only by GET /api/products/:id/claim-cta, which renders a different CTA
// for anonymous visitors. It must never 401 — a logged-out shopper still gets
// a page.

const originalGetUser = supabase.auth.getUser;

function withGetUser(impl, fn) {
  supabase.auth.getUser = impl;
  return fn().finally(() => { supabase.auth.getUser = originalGetUser; });
}

async function run(headers = {}) {
  const req = { headers };
  let nexted = false;
  await optionalAuth(req, {}, () => { nexted = true; });
  return { req, nexted };
}

describe('optionalAuth', () => {
  test('an anonymous request continues with no user attached', async () => {
    const { req, nexted } = await run();
    assert.equal(nexted, true);
    assert.equal(req.user, undefined);
  });

  test('a malformed header is treated as anonymous rather than refused', async () => {
    const { req, nexted } = await run({ authorization: 'Basic abc' });
    assert.equal(nexted, true);
    assert.equal(req.user, undefined);
  });

  test('a valid token identifies the caller', async () => {
    await withGetUser(
      async () => ({ data: { user: { id: 'u-1', email: 'a@b.c' } }, error: null }),
      async () => {
        const { req, nexted } = await run({ authorization: 'Bearer good' });
        assert.equal(nexted, true);
        assert.equal(req.user.id, 'u-1');
        assert.equal(req.token, 'good');
      },
    );
  });

  test('an expired token degrades to anonymous, never a 401', async () => {
    await withGetUser(
      async () => ({ data: { user: null }, error: { message: 'jwt expired' } }),
      async () => {
        const { req, nexted } = await run({ authorization: 'Bearer stale' });
        assert.equal(nexted, true);
        assert.equal(req.user, undefined);
      },
    );
  });

  test('a Supabase outage degrades to anonymous instead of a 500', async () => {
    await withGetUser(
      async () => { throw new Error('network down'); },
      async () => {
        const { req, nexted } = await run({ authorization: 'Bearer good' });
        assert.equal(nexted, true);
        assert.equal(req.user, undefined);
      },
    );
  });
});
