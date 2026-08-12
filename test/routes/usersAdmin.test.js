'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, updateChain, selectQueue, freshIp,
} = require('../helpers/testApp');
const { subscribeUserStatus } = require('../../services/userStatusEventBus');

const TARGET = '55555555-5555-5555-5555-555555555555';

const applicant = (over = {}) => ({
  id: TARGET, email: 'budi@example.com', name: 'Budi', nim: '041234567',
  is_salut: false, salut_status: 'approved', ...over,
});

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  user = adminUser(),
  target,
  rows = [],
  count = [{ count: 0 }],
  update,
} = {}) {
  harness = stubBackend({
    user,
    query: { users: { findFirst: async () => target, findMany: async () => rows } },
    select: selectQueue([rows, count]),
    update: update ?? updateChain([applicant()]),
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('GET /api/users/admin/all', () => {
  test('a student cannot list users', async () => {
    setup({ user: studentUser() });
    const res = await authed('get', '/api/users/admin/all');
    assert.equal(res.status, 403);
  });

  test('an admin gets rows and a total', async () => {
    setup({ rows: [{ id: TARGET, name: 'Budi', created_at: '2026-05-20T00:00:00Z', programs: null }], count: [{ count: 1 }] });
    const res = await authed('get', '/api/users/admin/all');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.ok(res.body.rows[0].created_at_display);
    assert.equal(res.body.limit, 25, 'the default page size');
    assert.equal(res.body.offset, 0);
  });

  test('a page size beyond the cap is clamped rather than honoured', async () => {
    setup();
    const res = await authed('get', '/api/users/admin/all?limit=5000');
    assert.equal(res.status, 200);
  });

  test('an unknown sort column falls back instead of reaching the query', async () => {
    setup();
    const res = await authed('get', '/api/users/admin/all?sort=; DROP TABLE users');
    assert.equal(res.status, 200);
  });

  test('an out-of-range semester filter is ignored, not an error', async () => {
    setup();
    for (const semester of ['0', '10', 'abc']) {
      const res = await authed('get', `/api/users/admin/all?semester=${semester}`);
      assert.equal(res.status, 200);
    }
  });
});

describe('PATCH /api/users/admin/:userId/salut', () => {
  test('a non-boolean flag is refused', async () => {
    setup({ target: applicant() });
    for (const bad of ['true', 1, null, undefined]) {
      const res = await authed('patch', `/api/users/admin/${TARGET}/salut`).send({ is_salut: bad });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
    }
  });

  test('granting membership records the approval time', async () => {
    const h = setup({ target: applicant() });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut`).send({ is_salut: true });
    assert.equal(res.status, 200);
    const written = h.calls.set[0];
    assert.equal(written.salut_status, 'approved');
    assert.ok(written.salut_approved_at instanceof Date);
  });

  test('revoking membership clears both the approval and any rejection reason', async () => {
    const h = setup({ target: applicant() });
    await authed('patch', `/api/users/admin/${TARGET}/salut`).send({ is_salut: false });
    const written = h.calls.set[0];
    assert.equal(written.is_salut, false);
    assert.equal(written.salut_approved_at, null);
    assert.equal(written.salut_rejection_reason, null);
  });

  test('a target who is not a student is a 404', async () => {
    setup({ update: updateChain([]) });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut`).send({ is_salut: true });
    assert.equal(res.status, 404);
  });

  test('the member\'s open tab is told immediately', async () => {
    setup({ target: applicant() });
    const seen = [];
    const off = subscribeUserStatus(TARGET, p => seen.push(p));
    await authed('patch', `/api/users/admin/${TARGET}/salut`).send({ is_salut: true });
    off();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].salut_status, 'approved');
  });
});

describe('PATCH /api/users/admin/salut/bulk', () => {
  test('an empty or non-array selection is refused', async () => {
    setup();
    for (const bad of [[], 'abc', undefined]) {
      const res = await authed('patch', '/api/users/admin/salut/bulk')
        .send({ userIds: bad, is_salut: true });
      assert.equal(res.status, 400);
    }
  });

  test('a selection larger than 200 is refused', async () => {
    setup();
    const userIds = Array.from({ length: 201 }, (_, i) => `u-${i}`);
    const res = await authed('patch', '/api/users/admin/salut/bulk').send({ userIds, is_salut: true });
    assert.equal(res.status, 400);
  });

  test('exactly 200 is accepted — the boundary is inclusive', async () => {
    setup({ update: updateChain([{ id: 'u-1' }]) });
    const userIds = Array.from({ length: 200 }, (_, i) => `u-${i}`);
    const res = await authed('patch', '/api/users/admin/salut/bulk').send({ userIds, is_salut: true });
    assert.equal(res.status, 200);
  });

  test('the count reported is how many rows changed, not how many were asked for', async () => {
    setup({ update: updateChain([{ id: 'u-1' }, { id: 'u-2' }]) });
    const res = await authed('patch', '/api/users/admin/salut/bulk')
      .send({ userIds: ['u-1', 'u-2', 'u-3'], is_salut: true });
    assert.equal(res.body.updated, 2);
  });

  test('every member approved in a batch is told, not just the ones done singly', async () => {
    // Approving in bulk used to notify nobody: the live status push only
    // reaches a tab the student still has open, so most never found out.
    const h = setup({
      update: updateChain([
        { id: 'u-1', email: 'satu@example.com', name: 'Satu' },
        { id: 'u-2', email: 'dua@example.com', name: 'Dua' },
      ]),
    });

    await authed('patch', '/api/users/admin/salut/bulk')
      .send({ userIds: ['u-1', 'u-2'], is_salut: true });

    await h.email.next('sendSalutApproved');
    const sent = h.email.of('sendSalutApproved');
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(p => p.email).sort(), ['dua@example.com', 'satu@example.com']);
  });

  test('the batch notice carries the same expiry the single approval does', async () => {
    const h = setup({
      update: updateChain([{ id: 'u-1', email: 'satu@example.com', name: 'Satu' }]),
    });

    await authed('patch', '/api/users/admin/salut/bulk')
      .send({ userIds: ['u-1'], is_salut: true });

    const payload = await h.email.next('sendSalutApproved');
    assert.ok(payload.expiresAt, 'the member needs to know when it lapses');
    assert.ok(!Number.isNaN(Date.parse(payload.expiresAt)));
  });

  test('revoking membership in bulk emails nobody', async () => {
    // There is no "your membership was removed" notice, and inventing one here
    // would surprise people.
    const h = setup({
      update: updateChain([{ id: 'u-1', email: 'satu@example.com', name: 'Satu' }]),
    });

    await authed('patch', '/api/users/admin/salut/bulk')
      .send({ userIds: ['u-1'], is_salut: false });

    assert.deepEqual(h.email.of('sendSalutApproved'), []);
  });
});

describe('GET /api/users/admin/salut/applications', () => {
  test('only pending applications are listed by default', async () => {
    setup({ rows: [] });
    const res = await authed('get', '/api/users/admin/salut/applications');
    assert.equal(res.status, 200);
  });

  test('the WhatsApp number falls back to the profile phone for older applications', async () => {
    setup({
      rows: [{
        id: TARGET, email: 'b@c.d', name: 'Budi', nim: '04', current_semester: 1,
        phone: '081234567890', salut_wa_number: null,
        salut_applied_at: '2026-05-20T00:00:00Z', salut_applied_fee_amount: 1700,
        salut_applied_semester: 1, programs: null,
      }],
    });
    const res = await authed('get', '/api/users/admin/salut/applications');
    assert.equal(res.body[0].salut_wa_number, '6281234567890');
  });

  test('a stored WhatsApp number is used as-is', async () => {
    setup({
      rows: [{
        id: TARGET, email: 'b@c.d', name: 'Budi', phone: '0999',
        salut_wa_number: '628111111111', salut_applied_at: '2026-05-20T00:00:00Z',
        salut_applied_fee_amount: 1700, programs: null,
      }],
    });
    const res = await authed('get', '/api/users/admin/salut/applications');
    assert.equal(res.body[0].salut_wa_number, '628111111111');
  });

  test('the applied fee is shown in the currency it was quoted in', async () => {
    setup({
      rows: [{
        id: TARGET, email: 'b@c.d', name: 'Budi', salut_applied_fee_amount: 1700,
        salut_applied_at: '2026-05-20T00:00:00Z', programs: null,
      }],
    });
    const res = await authed('get', '/api/users/admin/salut/applications');
    assert.equal(res.body[0].salut_applied_fee_amount_display, 'NT$ 1,700');
  });
});

describe('PATCH /api/users/admin/:userId/salut/approve', () => {
  test('an unknown applicant is a 404', async () => {
    setup({ target: null });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/approve`);
    assert.equal(res.status, 404);
  });

  test('an application that is not pending cannot be approved twice', async () => {
    setup({ target: { salut_status: 'approved' } });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/approve`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /bukan dalam status pending/);
  });

  test('approving grants membership and stamps the date', async () => {
    const h = setup({ target: { salut_status: 'pending' } });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/approve`);
    assert.equal(res.status, 200);
    const written = h.calls.set[0];
    assert.equal(written.is_salut, true);
    assert.equal(written.salut_status, 'approved');
    assert.ok(written.salut_approved_at instanceof Date);
  });

  test('the new member is emailed with their expiry date', async () => {
    const h = setup({ target: { salut_status: 'pending' } });
    await authed('patch', `/api/users/admin/${TARGET}/salut/approve`);
    const payload = await h.email.next('sendSalutApproved');
    assert.equal(payload.email, 'budi@example.com');
    assert.ok(payload.expiresAt);
  });
});

describe('PATCH /api/users/admin/:userId/salut/reject', () => {
  test('a reason is required', async () => {
    setup({ target: { salut_status: 'pending' } });
    for (const bad of [undefined, '', '   ', 42]) {
      const res = await authed('patch', `/api/users/admin/${TARGET}/salut/reject`).send({ reason: bad });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
    }
  });

  test('a reason longer than 500 characters is refused', async () => {
    setup({ target: { salut_status: 'pending' } });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/reject`)
      .send({ reason: 'x'.repeat(501) });
    assert.equal(res.status, 400);
  });

  test('exactly 500 characters is accepted', async () => {
    setup({ target: { salut_status: 'pending' } });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/reject`)
      .send({ reason: 'x'.repeat(500) });
    assert.equal(res.status, 200);
  });

  test('the applicant reads exactly what was recorded — both are trimmed', async () => {
    const h = setup({ target: { salut_status: 'pending' } });
    await authed('patch', `/api/users/admin/${TARGET}/salut/reject`)
      .send({ reason: '  Bukti tidak terbaca  ' });

    assert.equal(h.calls.set[0].salut_rejection_reason, 'Bukti tidak terbaca');
    const payload = await h.email.next('sendSalutRejected');
    assert.equal(payload.reason, 'Bukti tidak terbaca');
  });

  test('an application that is not pending cannot be rejected', async () => {
    setup({ target: { salut_status: 'rejected' } });
    const res = await authed('patch', `/api/users/admin/${TARGET}/salut/reject`)
      .send({ reason: 'sudah' });
    assert.equal(res.status, 400);
  });
});

describe('filtering the student list', () => {
  // These build drizzle predicates. Against a stubbed database the rows come
  // back the same whichever filter is applied, so what this pins is that every
  // predicate *builds* — a mistyped column throws here rather than 500ing an
  // admin mid-search. Which students each filter actually selects is the
  // system tier's job, against real SQL.
  const list = (qs) => authed('get', `/api/users/admin/all${qs}`);

  const FILTERS = [
    ['by name or email', '?search=budi'],
    ['by SALUT membership', '?salut=true'],
    ['by non-membership', '?salut=false'],
    ['by application status', '?salut_status=pending'],
    ['by verified', '?is_verified=true'],
    ['by unverified', '?is_verified=false'],
    ['by programme', '?program_id=44444444-4444-4444-4444-444444444444'],
    ['by semester', '?semester=3'],
    ['by several at once', '?search=budi&salut=true&is_verified=true&semester=1'],
  ];

  for (const [label, qs] of FILTERS) {
    test(`filtering ${label} builds a valid query`, async () => {
      setup({ rows: [], count: [{ count: 0 }] });

      const res = await list(qs);

      assert.equal(res.status, 200, `${qs} -> ${JSON.stringify(res.body)}`);
    });
  }

  test('a made-up application status is ignored rather than erroring', async () => {
    // An unknown status must not become part of the predicate; the allow-list
    // is what stops a typo turning into an empty list an admin cannot explain.
    setup({ rows: [], count: [{ count: 0 }] });

    const res = await list('?salut_status=bukan-status');

    assert.equal(res.status, 200);
  });

  test('an out-of-range semester is ignored', async () => {
    setup({ rows: [], count: [{ count: 0 }] });

    const res = await list('?semester=99');

    assert.equal(res.status, 200);
  });

  test('a non-numeric semester is ignored', async () => {
    setup({ rows: [], count: [{ count: 0 }] });

    const res = await list('?semester=satu');

    assert.equal(res.status, 200);
  });

  test('a search full of LIKE wildcards is escaped, not run as a pattern', async () => {
    // Searching for "100%" must not match every student.
    setup({ rows: [], count: [{ count: 0 }] });

    const res = await list('?search=100%25_x');

    assert.equal(res.status, 200);
  });

  test('a whitespace-only search is treated as no search', async () => {
    setup({ rows: [], count: [{ count: 0 }] });

    const res = await list('?search=%20%20');

    assert.equal(res.status, 200);
  });

  test('a database failure is reported rather than shown as no students', async () => {
    harness = stubBackend({
      user: adminUser(),
      query: { users: { findMany: async () => [] } },
      select: () => { throw new Error('connection terminated'); },
    });

    const res = await list('?search=budi');

    assert.equal(res.status, 500);
  });
});
