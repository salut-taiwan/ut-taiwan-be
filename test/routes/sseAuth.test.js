'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, updateChain, selectChain, freshIp } = require('../helpers/testApp');

// EventSource cannot set an Authorization header, so the live-status stream
// takes its token in the query string instead. That is the one place in the
// API where a credential travels in a URL, which makes its gate worth pinning
// exactly: everything else about the stream is useless if this lets a stranger
// through.

const USER_ID = '33333333-3333-3333-3333-333333333333';

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({ user = studentUser({ id: USER_ID }), authError = null } = {}) {
  harness = stubBackend({
    user: authError ? null : user,
    select: selectChain([]),
    update: updateChain([]),
  });
  return harness;
}

/** The stream never closes, so every request is abandoned after first bytes. */
const open = (query) =>
  request(app)
    .get(`/api/sse/status${query}`)
    .set('X-Forwarded-For', freshIp())
    .timeout({ deadline: 300 })
    .catch((err) => err.response ?? err);

describe('opening the live status stream', () => {
  test('a valid token opens the stream', async () => {
    setup();

    const res = await open('?token=good-token');

    // A timeout here means the stream opened and stayed open, which is the
    // success case for SSE — what must never happen is a 401.
    assert.notEqual(res.status, 401);
    assert.ok(res.status === 200 || res.timeout, `unexpected: ${res.status}`);
  });

  test('no token at all is refused', async () => {
    setup();

    const res = await open('');

    assert.equal(res.status, 401);
  });

  test('an empty token is refused rather than treated as absent-but-fine', async () => {
    setup();

    const res = await open('?token=');

    assert.equal(res.status, 401);
  });

  test('a token the auth provider rejects is refused', async () => {
    setup({ authError: true });

    const res = await open('?token=forged');

    assert.equal(res.status, 401);
  });

  test('a bearer header alone does not open the stream', async () => {
    // The header path is a different middleware; this route only reads the
    // query string, so a client that sends the header and no token must be
    // told so rather than silently getting an empty stream.
    setup();

    const res = await request(app)
      .get('/api/sse/status')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', 'Bearer good-token')
      .timeout({ deadline: 300 })
      .catch((err) => err.response ?? err);

    assert.equal(res.status, 401);
  });

  test('a verified account has its stale is_verified flag healed on connect', async () => {
    // Supabase confirms the email; our own row can lag behind. Opening the
    // stream is a convenient moment to catch up.
    const h = setup();

    await open('?token=good-token');

    assert.ok(h.calls.authHeal.length > 0, 'the heal write should have run');
    assert.equal(h.calls.authHeal[0].is_verified, true);
  });

  test('a failed heal does not stop the stream opening', async () => {
    // The heal is opportunistic; losing it must not cost the student their
    // live updates.
    harness = stubBackend({
      user: studentUser({ id: USER_ID }),
      select: selectChain([]),
      update: () => { throw new Error('connection terminated'); },
    });

    const res = await open('?token=good-token');

    assert.notEqual(res.status, 401);
    assert.ok(res.status === 200 || res.timeout, `unexpected: ${res.status}`);
  });
});
