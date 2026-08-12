'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, insertChain, updateChain, selectChain, freshIp,
} = require('../helpers/testApp');

const SKS_ID = '88888888-8888-8888-8888-888888888888';

const row = (over = {}) => ({
  id: SKS_ID, nim: '041234567', name: 'Budi', semester_period: '2026.1',
  idr_amount: '5600000.00', ntd_amount: '10000.00', rate_idr_per_ntd: '560.00',
  ut_slip_url: 'u/slip.pdf', transfer_proof_url: 'u/proof.png',
  status: 'pending', rejection_reason: null, completed_at: null,
  created_at: '2026-05-20T00:00:00Z', email: 'budi@example.com',
  ...over,
});

const SUBMISSION = {
  nim: '041234567',
  name: 'Budi Santoso',
  semester_period: '2026.1',
  idr_amount: 5600000,
  ut_slip_url: 'u-1/slip_1.pdf',
  transfer_proof_url: 'u-1/proof_1.png',
};

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  user = studentUser(),
  record = row(),
  rows = [row()],
  insert,
  update,
  storage,
} = {}) {
  harness = stubBackend({
    user,
    query: {
      sks_payments: { findFirst: async () => record, findMany: async () => rows },
      // complete/reject look the applicant's address up for the notification.
      users: { findFirst: async () => ({ email: 'budi@example.com' }) },
    },
    // The admin list is a joined select, not a relational query.
    select: selectChain(rows),
    insert: insert ?? insertChain([row()]),
    update: update ?? updateChain([row({ status: 'completed' })]),
    storage,
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('POST /api/sks-payment/quote', () => {
  test('a non-positive amount is refused', async () => {
    setup();
    for (const bad of [0, -1, 'abc', undefined]) {
      const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: bad });
      assert.equal(res.status, 400, `${String(bad)} should be refused`);
    }
  });

  test('an amount over the cap is refused', async () => {
    setup();
    const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: 100000001 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /maksimal Rp 100.000.000/);
  });

  test('exactly the cap is allowed', async () => {
    setup();
    const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: 100000000 });
    assert.equal(res.status, 200);
  });

  test('the quote rounds up so the transfer is never short', async () => {
    setup();
    const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: 561 });
    assert.equal(res.body.ntd_amount, 2);
  });

  test('the published rate is shown alongside the amounts', async () => {
    setup();
    const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: 5600000 });
    assert.equal(res.body.ntd_amount, 10000);
    assert.equal(res.body.rate_label, 'Rp 560 / NT$ 1');
    assert.ok(res.body.idr_amount_display);
  });

  test('the transfer memo is suggested for the student', async () => {
    setup();
    const res = await authed('post', '/api/sks-payment/quote').send({ idr_amount: 5600 });
    assert.match(res.body.memo_hint, /^SKS /);
  });
});

describe('POST /api/sks-payment', () => {
  test('each field has its own message so the form can point at the problem', async () => {
    setup();
    const cases = [
      [{ nim: '' }, /NIM/],
      [{ nim: 'x'.repeat(21) }, /NIM/],
      [{ name: '' }, /Nama/],
      [{ name: 'x'.repeat(121) }, /Nama/],
      [{ semester_period: '' }, /Semester/],
      [{ semester_period: 'x'.repeat(31) }, /Semester/],
      [{ idr_amount: 0 }, /positif/],
      [{ idr_amount: 100000001 }, /maksimal/],
      [{ ut_slip_url: '' }, /Slip pembayaran UT/],
      [{ transfer_proof_url: '' }, /Bukti transfer/],
    ];
    for (const [override, pattern] of cases) {
      const res = await authed('post', '/api/sks-payment').send({ ...SUBMISSION, ...override });
      assert.equal(res.status, 400, JSON.stringify(override));
      assert.match(res.body.error, pattern);
    }
  });

  test('the NTD amount is computed server-side, not taken from the client', async () => {
    const h = setup();
    await authed('post', '/api/sks-payment').send({ ...SUBMISSION, ntd_amount: 1 });
    const written = h.calls.values[0];
    assert.equal(written.ntd_amount, '10000');
    assert.equal(written.rate_idr_per_ntd, '560');
  });

  test('text fields are trimmed before storage', async () => {
    const h = setup();
    await authed('post', '/api/sks-payment').send({
      ...SUBMISSION, nim: '  041234567  ', name: '  Budi  ',
    });
    assert.equal(h.calls.values[0].nim, '041234567');
    assert.equal(h.calls.values[0].name, 'Budi');
  });

  test('a new request starts as pending', async () => {
    const h = setup();
    const res = await authed('post', '/api/sks-payment').send(SUBMISSION);
    assert.equal(res.status, 200);
    assert.equal(h.calls.values[0].status, 'pending');
  });

  test('a storage failure is reported without leaking internals', async () => {
    setup({ insert: () => { throw new Error('constraint violation on sks_payments_pkey'); } });
    const res = await authed('post', '/api/sks-payment').send(SUBMISSION);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'Gagal menyimpan permohonan');
  });
});

describe('GET /api/sks-payment/mine', () => {
  test('a student sees their own requests with display fields', async () => {
    setup();
    const res = await authed('get', '/api/sks-payment/mine');
    assert.equal(res.status, 200);
    assert.equal(res.body[0].status_label, 'Menunggu Verifikasi');
    assert.ok(res.body[0].idr_amount_display);
  });
});

describe('SKS payment admin endpoints', () => {
  test('a student cannot reach any of them', async () => {
    setup({ user: studentUser() });
    const paths = [
      ['get', '/api/sks-payment/admin/all'],
      ['get', `/api/sks-payment/admin/${SKS_ID}/slip-url`],
      ['get', `/api/sks-payment/admin/${SKS_ID}/proof-url`],
      ['patch', `/api/sks-payment/admin/${SKS_ID}/complete`],
      ['patch', `/api/sks-payment/admin/${SKS_ID}/reject`],
    ];
    for (const [method, path] of paths) {
      const res = await authed(method, path).send({ reason: 'x' });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });

  test('the admin list carries the applicant email', async () => {
    setup({ user: adminUser() });
    const res = await authed('get', '/api/sks-payment/admin/all');
    assert.equal(res.status, 200);
    assert.equal(res.body[0].email, 'budi@example.com');
  });

  test('a signed link is short-lived', async () => {
    const h = setup({ user: adminUser() });
    const res = await authed('get', `/api/sks-payment/admin/${SKS_ID}/slip-url`);
    assert.equal(res.status, 200);
    const signed = h.calls.storage.find(c => c.op === 'createSignedUrl');
    assert.equal(signed.expiresIn, 300);
  });

  test('a request with no file on record is a 404', async () => {
    setup({ user: adminUser(), record: { ut_slip_url: null } });
    const res = await authed('get', `/api/sks-payment/admin/${SKS_ID}/slip-url`);
    assert.equal(res.status, 404);
  });

  test('completing marks it done and stamps the time', async () => {
    const h = setup({ user: adminUser() });
    const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/complete`);
    assert.equal(res.status, 200);
    assert.equal(h.calls.set[0].status, 'completed');
    assert.ok(h.calls.set[0].completed_at instanceof Date);
  });

  test('a second admin clicking complete is told it is already handled', async () => {
    // The update is conditional on status = pending, so zero rows means someone
    // already processed it — and the student must not be emailed twice.
    setup({ user: adminUser(), update: updateChain([]) });
    const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/complete`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Sudah diproses');
  });

  test('the student is emailed when their payment completes', async () => {
    const h = setup({ user: adminUser() });
    await authed('patch', `/api/sks-payment/admin/${SKS_ID}/complete`);
    const payload = await h.email.next('sendSksPaymentCompleted');
    assert.equal(payload.email, 'budi@example.com');
  });

  test('a rejection needs a reason', async () => {
    setup({ user: adminUser() });
    for (const bad of [undefined, '', '   ']) {
      const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/reject`).send({ reason: bad });
      assert.equal(res.status, 400);
    }
  });

  test('a reason longer than 500 characters is refused', async () => {
    setup({ user: adminUser() });
    const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/reject`)
      .send({ reason: 'x'.repeat(501) });
    assert.equal(res.status, 400);
  });

  test('rejecting records the trimmed reason', async () => {
    const h = setup({ user: adminUser(), update: updateChain([row({ status: 'rejected' })]) });
    const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/reject`)
      .send({ reason: '  Nominal tidak cocok  ' });
    assert.equal(res.status, 200);
    assert.equal(h.calls.set[0].rejection_reason, 'Nominal tidak cocok');
  });

  test('a double rejection is also refused', async () => {
    setup({ user: adminUser(), update: updateChain([]) });
    const res = await authed('patch', `/api/sks-payment/admin/${SKS_ID}/reject`)
      .send({ reason: 'sudah' });
    assert.equal(res.status, 409);
  });
});

describe('uploading the two files a SKS payment needs', () => {
  // A student uploads their UT payment slip and their bank transfer proof.
  // Both go to a private bucket under their own user id, which is what keeps
  // one student's slip out of another's reach.
  const PDF = Buffer.from('%PDF-1.4 slip');

  const send = (path, { name = 'slip.pdf', type = 'application/pdf', body = PDF } = {}) =>
    authed('post', path).attach('file', body, { filename: name, contentType: type });

  const uploads = [
    ['the UT slip', '/api/sks-payment/upload-slip', 'slip'],
    ['the transfer proof', '/api/sks-payment/upload-proof', 'proof'],
  ];

  for (const [label, path, kind] of uploads) {
    test(`${label} is stored under the student's own folder`, async () => {
      const h = setup({ storage: { upload: async () => ({ data: { path: 'p' }, error: null }) } });

      const res = await send(path);

      assert.equal(res.status, 200);
      const up = h.calls.storage.find(c => c.op === 'upload');
      assert.ok(up.path.startsWith(`${h.user.id}/`), `stored at ${up.path}`);
      assert.match(up.path, new RegExp(`/${kind}_`));
      assert.equal(res.body.url, up.path);
    });

    test(`${label} keeps its extension, so the file opens later`, async () => {
      const h = setup({ storage: { upload: async () => ({ data: { path: 'p' }, error: null }) } });

      await send(path);

      assert.match(h.calls.storage.find(c => c.op === 'upload').path, /\.pdf$/);
    });

    test(`${label} refuses to overwrite an existing object`, async () => {
      // Two uploads in the same millisecond must not let one student's file
      // replace another's.
      const h = setup({ storage: { upload: async () => ({ data: { path: 'p' }, error: null }) } });

      await send(path);

      assert.equal(h.calls.storage.find(c => c.op === 'upload').options.upsert, false);
    });

    test(`${label} with no file attached is a 400`, async () => {
      setup();

      const res = await authed('post', path);

      assert.equal(res.status, 400);
    });

    test(`${label} rejects a file type that is not a slip`, async () => {
      setup();

      const res = await send(path, { name: 'virus.exe', type: 'application/x-msdownload' });

      assert.equal(res.status, 400);
    });

    test(`${label} reports a storage failure instead of returning a dead path`, async () => {
      setup({
        storage: { upload: async () => ({ data: null, error: { message: 'bucket full' } }) },
      });

      const res = await send(path);

      assert.equal(res.status, 500);
      assert.match(res.body.error, /Gagal mengunggah/);
    });

    test(`${label} requires signing in`, async () => {
      harness = stubBackend({ user: null, select: selectChain([]) });

      const res = await request(app)
        .post(path)
        .set('X-Forwarded-For', freshIp())
        .attach('file', PDF, { filename: 'slip.pdf', contentType: 'application/pdf' });

      assert.equal(res.status, 401);
    });
  }

  test('an image slip is accepted too, since most students photograph theirs', async () => {
    const h = setup({ storage: { upload: async () => ({ data: { path: 'p' }, error: null }) } });

    const res = await send('/api/sks-payment/upload-slip', {
      name: 'slip.jpg', type: 'image/jpeg', body: Buffer.from('\xff\xd8\xff jpeg'),
    });

    assert.equal(res.status, 200);
    assert.match(h.calls.storage.find(c => c.op === 'upload').path, /\.jpg$/);
  });

  test('the two uploads never collide, even back to back', async () => {
    const h = setup({ storage: { upload: async () => ({ data: { path: 'p' }, error: null }) } });

    await send('/api/sks-payment/upload-slip');
    await send('/api/sks-payment/upload-proof');

    const paths = h.calls.storage.filter(c => c.op === 'upload').map(c => c.path);
    assert.equal(new Set(paths).size, 2);
  });
});
