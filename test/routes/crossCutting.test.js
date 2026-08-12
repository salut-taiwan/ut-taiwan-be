'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, freshIp } = require('../helpers/testApp');
const env = require('../../config/env');

let harness = null;
const originalFetch = globalThis.fetch;
afterEach(() => {
  harness?.restore();
  harness = null;
  globalThis.fetch = originalFetch;
});

const req = (path) => request(app).get(path).set('X-Forwarded-For', freshIp());

describe('health and error shapes', () => {
  test('the health probe answers without touching the database', async () => {
    const res = await req('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(!Number.isNaN(Date.parse(res.body.timestamp)));
  });

  test('an unknown path is a 404 with a consistent body', async () => {
    const res = await req('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
  });

  test('an unknown path under a mounted router is the same shape', async () => {
    const res = await req('/api/orders/admin/nope/nope');
    assert.ok([401, 404].includes(res.status));
    assert.ok(res.body.error);
  });

  test('malformed JSON is rejected as a client error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('no stack trace leaks outside development', async () => {
    harness = stubBackend({
      user: studentUser(),
      query: { orders: { findFirst: () => { throw new Error('boom'); } } },
    });
    const res = await request(app)
      .get('/api/orders/11111111-1111-1111-1111-111111111111')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', 'Bearer t');
    assert.equal(res.status, 500);
    assert.equal(res.body.stack, undefined);
  });
});

describe('security headers and CORS', () => {
  test('helmet sets the sniffing guard and hides the framework', async () => {
    const res = await req('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('a request with no Origin is allowed — server-to-server calls still work', async () => {
    const res = await req('/api/health');
    assert.equal(res.status, 200);
  });

  test('the configured frontend is granted access', async () => {
    const res = await req('/api/health').set('Origin', env.FRONTEND_URL);
    assert.equal(res.headers['access-control-allow-origin'], env.FRONTEND_URL);
  });

  test('an unlisted origin gets no grant header — the browser is what blocks it', async () => {
    // The server does not 403; it simply withholds the header.
    const res = await req('/api/health').set('Origin', 'https://evil.example.com');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

describe('rate limiting', () => {
  test('the API advertises its budget', async () => {
    const res = await req('/api/health');
    assert.equal(res.headers['ratelimit-limit'], '200');
    assert.ok(res.headers['ratelimit-remaining']);
  });

  test('each client gets its own budget', async () => {
    const first = await req('/api/health');
    const second = await req('/api/health');
    // Distinct IPs, so both see a full-but-one budget rather than a shared count.
    assert.equal(first.headers['ratelimit-remaining'], second.headers['ratelimit-remaining']);
  });

  test('image traffic is exempt so a catalog page cannot exhaust the budget', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['Content-Type', 'image/png']]),
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    });
    const res = await req('/api/storage/v1/object/public/x.png');
    assert.equal(res.headers['ratelimit-limit'], undefined);
  });
});

describe('storage proxy', () => {
  function stubUpstream(impl) {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(url);
      return impl(url);
    };
    return seen;
  }

  const okPng = () => ({
    ok: true,
    status: 200,
    headers: new Map([['Content-Type', 'image/png']]),
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => (sent ? { done: true } : (sent = true, { done: false, value: Buffer.from('img') })),
        };
      },
    },
  });

  test('the upstream URL is anchored to the configured Supabase host', async () => {
    const seen = stubUpstream(okPng);
    await req('/api/storage/v1/object/public/module-covers/a.png');
    assert.equal(seen[0], `${env.SUPABASE_URL}/storage/v1/object/public/module-covers/a.png`);
  });

  test('a traversal attempt cannot escape that host', async () => {
    const seen = stubUpstream(okPng);
    await req('/api/storage/../../etc/passwd');
    for (const url of seen) {
      assert.ok(url.startsWith(`${env.SUPABASE_URL}/storage/`), `${url} escaped the anchor`);
    }
  });

  test('an encoded traversal is likewise anchored', async () => {
    const seen = stubUpstream(okPng);
    await req('/api/storage/%2e%2e%2f%2e%2e%2fetc/passwd');
    for (const url of seen) {
      assert.ok(url.startsWith(`${env.SUPABASE_URL}/storage/`));
    }
  });

  test('the content type and a long cache lifetime come back with the bytes', async () => {
    stubUpstream(okPng);
    const res = await req('/api/storage/v1/object/public/a.png');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  test('a missing object passes the upstream status through', async () => {
    stubUpstream(() => ({ ok: false, status: 404, headers: new Map() }));
    const res = await req('/api/storage/v1/object/public/missing.png');
    assert.equal(res.status, 404);
  });

  test('an unreachable upstream is a bad gateway, not a 500', async () => {
    stubUpstream(() => { throw new Error('ECONNREFUSED'); });
    const res = await req('/api/storage/v1/object/public/a.png');
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'Gagal mengambil file');
  });

  test('an upstream with no content type falls back to a generic one', async () => {
    stubUpstream(() => ({
      ok: true, status: 200, headers: new Map(),
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    }));
    const res = await req('/api/storage/v1/object/public/a.bin');
    assert.equal(res.headers['content-type'], 'application/octet-stream');
  });

  test('the proxy needs no authentication — images load for signed-out visitors', async () => {
    stubUpstream(okPng);
    const res = await req('/api/storage/v1/object/public/a.png');
    assert.equal(res.status, 200);
  });
});

describe('public catalog endpoints', () => {
  test('the fee configuration is public and carries both currencies', async () => {
    const res = await req('/api/config/fees');
    assert.equal(res.status, 200);
    assert.ok(res.body.salutMembership.new_display);
    assert.ok(res.body.salutMembership.new_display_idr);
  });

  test('bank lists are served per currency', async () => {
    const ntd = await req('/api/config/banks?currency=NTD');
    assert.equal(ntd.status, 200);
    assert.ok(ntd.body.banks.length > 0);
  });

  test('an unsupported currency is refused', async () => {
    const res = await req('/api/config/banks?currency=USD');
    assert.equal(res.status, 400);
  });
});
