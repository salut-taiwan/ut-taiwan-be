'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PgDialect } = require('drizzle-orm/pg-core');
const { app, stubBackend, studentUser, updateChain, freshIp } = require('../helpers/testApp');
const { db } = require('../../db');

// Exercise the same loaded controllers as production, without recompiling
// their source in a VM under colliding coverage filenames.
let current;
afterEach(() => { current?.restore(); current = null; });

function application(overrides = {}, save = true) {
  current?.restore();
  const user = studentUser();
  current = stubBackend({
    user,
    query: { users: { findFirst: async () => ({
      is_salut: false, salut_status: 'none', current_semester: 3,
      salut_approved_at: null, nim: '000000001', ...overrides,
    }) } },
    update: updateChain(save ? [{ id: user.id }] : []),
  });
  const predicates = [];
  const update = db.update;
  db.update = (...args) => {
    const chain = update(...args);
    const where = chain.where;
    chain.where = predicate => { predicates.push(predicate); return where(predicate); };
    return chain;
  };
  return { ...current, predicates };
}

function apply(h, extra = {}) {
  return request(app).post('/api/salut/apply').set('Authorization', 'Bearer test').send({
    proofUrl: `${h.user.id}/proof.jpg`, wa_number: '+886900000001',
    note: 'Nama pengirim berbeda', ...extra,
  });
}

test('a returning student submits NTD 1700 and the note is persisted', async () => {
  const h = application();
  const res = await apply(h);
  assert.equal(res.status, 200);
  assert.equal(res.body.fee.amount, 1700);
  assert.equal(res.body.nextExpiry, null);
  assert.equal(h.calls.set[0].salut_payment_note, 'Nama pengirim berbeda');
  assert.equal(h.calls.set[0].salut_applied_fee_amount, 1700);
  const predicate = h.predicates.find(value => new PgDialect().sqlToQuery(value).params.includes('pending'));
  const query = new PgDialect().sqlToQuery(predicate);
  assert.match(query.sql, /"salut_status" <>/);
  for (const status of ['pending', 'approved', 'expired']) assert.ok(query.params.includes(status));
});

test('unknown semester does not block a one-time contribution', async () => {
  const h = application({ current_semester: null });
  const res = await apply(h);
  assert.equal(res.status, 200);
  assert.equal(h.calls.set[0].salut_applied_semester, null);
});

test('pending, approved and historical expired students cannot pay again', async () => {
  for (const row of [{ salut_status: 'pending' }, { salut_status: 'approved', salut_approved_at: '2020-01-01' }, { salut_status: 'expired' }]) {
    const h = application(row);
    const res = await apply(h);
    assert.ok([400, 409].includes(res.status));
    assert.equal(h.calls.set.length, 0);
  }
});

test('a receipt belonging to another account is rejected', async () => {
  const h = application();
  const res = await apply(h, { proofUrl: 'someone-else/proof.jpg' });
  assert.equal(res.status, 400);
  assert.equal(h.calls.set.length, 0);
});

test('oversized notes are rejected before saving', async () => {
  const h = application();
  const res = await apply(h, { note: 'x'.repeat(1001) });
  assert.equal(res.status, 400);
  assert.equal(h.calls.set.length, 0);
});

test('a concurrent status change yields a conflict instead of success', async () => {
  const h = application({}, false);
  const res = await apply(h);
  assert.equal(res.status, 409);
});

function auth(matches) {
  current?.restore();
  const calls = [];
  current = stubBackend({
    query: { users: { findMany: async () => matches } },
    auth: {
      signInWithPassword: async data => {
        calls.push(data);
        return { data: {
          session: { access_token: 'test', refresh_token: 'test', expires_at: 1 },
          user: { id: '33333333-3333-3333-3333-333333333333', email: data.email },
        }, error: null };
      },
    },
  });
  return calls;
}
const login = data => request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send(data);

test('NIM login resolves the registered email and still checks the password', async () => {
  const calls = auth([{ email: 'student@example.invalid' }]);
  const res = await login({ email: '000000001', password: 'test-password' });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ email: 'student@example.invalid', password: 'test-password' }]);
});

test('unknown or ambiguous NIM cannot authenticate another account', async () => {
  for (const matches of [[], [{ email: 'one@example.invalid' }, { email: 'two@example.invalid' }]]) {
    const calls = auth(matches);
    const res = await login({ email: '000000001', password: 'test' });
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  }
});

test('existing email login remains supported', async () => {
  const calls = auth([]);
  const res = await login({ email: 'student@example.invalid', password: 'test' });
  assert.equal(res.status, 200);
  assert.equal(calls[0].email, 'student@example.invalid');
});
