'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const {
  app, stubBackend, studentUser, adminUser, updateChain, selectChain, freshIp,
} = require('../helpers/testApp');

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

function setup({
  user = studentUser(),
  order = { id: ORDER_ID },
  payment,
  paymentRows = [],
  userRecord = { role: 'student' },
  storage,
  rpc,
} = {}) {
  harness = stubBackend({
    user,
    query: {
      orders: { findFirst: async () => order },
      payments: { findFirst: async () => payment },
      users: { findFirst: async () => userRecord },
    },
    select: selectChain(paymentRows),
    update: updateChain([{ id: 'pay-1' }]),
    storage,
    rpc,
  });
  return harness;
}

const authed = (method, path) =>
  request(app)[method](path).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

const png = (req, field = 'file') =>
  req.attach(field, Buffer.from('image-bytes'), { filename: 'bukti.png', contentType: 'image/png' });

describe('POST /api/payments/:orderId/proof', () => {
  test('a request with no file is refused', async () => {
    setup({ order: { id: ORDER_ID } });
    const res = await authed('post', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'File wajib dilampirkan');
  });

  test('an order belonging to someone else cannot receive a proof', async () => {
    setup({ order: null });
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/proof`));
    assert.equal(res.status, 404);
    assert.match(res.body.error, /belum dalam status menunggu pembayaran/);
  });

  test('an order not yet awaiting payment cannot receive a proof', async () => {
    // The status is part of the lookup predicate, so a pending order misses.
    setup({ order: null });
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/proof`));
    assert.equal(res.status, 404);
  });

  test('the stored path is scoped to the order and named from the verified MIME type', async () => {
    const h = setup();
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/proof`));
    assert.equal(res.status, 200);
    const upload = h.calls.storage.find(c => c.op === 'upload');
    assert.equal(upload.bucket, 'payment-docs');
    assert.match(upload.path, new RegExp(`^proofs/${ORDER_ID}/\\d+\\.png$`));
  });

  test('a doctored filename cannot influence the stored extension', async () => {
    // The extension comes from the MIME type multer already validated, so a
    // filename like "x.png/../../evil" has nowhere to go.
    const h = setup();
    await authed('post', `/api/payments/${ORDER_ID}/proof`)
      .attach('file', Buffer.from('x'), { filename: '../../evil.sh', contentType: 'image/png' });
    const upload = h.calls.storage.find(c => c.op === 'upload');
    assert.match(upload.path, new RegExp(`^proofs/${ORDER_ID}/\\d+\\.png$`));
  });

  test('both the path and the upload timestamp are recorded', async () => {
    const h = setup();
    await png(authed('post', `/api/payments/${ORDER_ID}/proof`));
    const written = h.calls.set[0];
    assert.ok(written.proof_path);
    assert.ok(written.proof_uploaded_at instanceof Date);
  });

  test('a storage failure is reported rather than silently losing the file', async () => {
    setup({ storage: { upload: async () => ({ data: null, error: { message: 'bucket full' } }) } });
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/proof`));
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'bucket full');
  });

  test('a disallowed file type is refused with a format message', async () => {
    setup();
    const res = await authed('post', `/api/payments/${ORDER_ID}/proof`)
      .attach('file', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Format file tidak didukung/);
  });
});

describe('POST /api/payments/:orderId/invoice', () => {
  test('only an admin may file an invoice', async () => {
    setup({ user: studentUser() });
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/invoice`));
    assert.equal(res.status, 403);
  });

  test('an invoice cannot be filed against an order that does not exist', async () => {
    // Previously this wrote a path for any id and answered ok.
    const h = setup({ user: adminUser(), order: null });
    const res = await png(authed('post', `/api/payments/${ORDER_ID}/invoice`));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Pesanan tidak ditemukan');
    assert.equal(h.calls.storage.length, 0);
  });

  test('an admin files an invoice against a real order', async () => {
    const h = setup({ user: adminUser() });
    const res = await authed('post', `/api/payments/${ORDER_ID}/invoice`)
      .attach('file', Buffer.from('%PDF-'), { filename: 'inv.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 200);
    const upload = h.calls.storage.find(c => c.op === 'upload');
    assert.match(upload.path, new RegExp(`^invoices/${ORDER_ID}/\\d+\\.pdf$`));
    assert.ok(h.calls.set[0].invoice_path);
  });
});

describe('GET /api/payments/:orderId/proof', () => {
  test('the owner can view their own proof', async () => {
    setup({ payment: { proof_path: 'proofs/x/1.png' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['content-disposition'], 'inline');
  });

  test('an admin may view a proof on an order they do not own', async () => {
    setup({ user: adminUser(), userRecord: { role: 'admin' }, payment: { proof_path: 'proofs/x/1.pdf' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
  });

  test('another student cannot view someone else\'s proof', async () => {
    setup({ order: null, payment: { proof_path: 'proofs/x/1.png' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 404);
  });

  test('an order with no uploaded proof is a 404', async () => {
    setup({ payment: { proof_path: null } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Bukti tidak ditemukan');
  });

  test('an unknown extension falls back to a generic content type', async () => {
    setup({ payment: { proof_path: 'proofs/x/1.heic' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.headers['content-type'], 'application/octet-stream');
  });

  test('a storage failure is a 500 with a generic message', async () => {
    setup({
      payment: { proof_path: 'proofs/x/1.png' },
      storage: { download: async () => ({ data: null, error: { message: 'gone' } }) },
    });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'Gagal memuat file');
  });

  test('the bytes returned are the bytes stored', async () => {
    const bytes = Buffer.from('exact-file-content');
    setup({
      payment: { proof_path: 'proofs/x/1.png' },
      storage: { download: async () => ({ data: { arrayBuffer: async () => bytes }, error: null }) },
    });
    const res = await authed('get', `/api/payments/${ORDER_ID}/proof`);
    assert.equal(Buffer.from(res.body).toString(), 'exact-file-content');
  });
});

describe('GET /api/payments/:orderId/invoice', () => {
  test('a student cannot read the Karunika invoice', async () => {
    setup({ user: studentUser(), payment: { invoice_path: 'invoices/x/1.pdf' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/invoice`);
    assert.equal(res.status, 403);
  });

  test('an admin can', async () => {
    setup({ user: adminUser(), payment: { invoice_path: 'invoices/x/1.pdf' } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/invoice`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
  });

  test('no invoice on file is a 404', async () => {
    setup({ user: adminUser(), payment: { invoice_path: null } });
    const res = await authed('get', `/api/payments/${ORDER_ID}/invoice`);
    assert.equal(res.status, 404);
  });
});

describe('GET /api/payments/:orderId', () => {
  test('another user\'s order is a 404', async () => {
    setup({ order: null });
    const res = await authed('get', `/api/payments/${ORDER_ID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Pesanan tidak ditemukan');
  });

  test('an order with no payment row is a 404', async () => {
    setup({ paymentRows: [] });
    const res = await authed('get', `/api/payments/${ORDER_ID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Data pembayaran tidak ditemukan');
  });

  test('the presented payment is returned', async () => {
    setup({
      paymentRows: [{
        id: 'pay-1', status: 'pending', amount: 525425, unique_code: 425,
        method: 'transfer', bank: 'BCA', created_at: '2026-05-20T00:00:00Z',
      }],
    });
    const res = await authed('get', `/api/payments/${ORDER_ID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'pay-1');
    assert.ok(res.body.amount_display, 'the presenter should add display fields');
  });
});

describe('POST /api/payments/:orderId/confirm', () => {
  test('a student cannot confirm their own payment', async () => {
    setup({ user: studentUser() });
    const res = await authed('post', `/api/payments/${ORDER_ID}/confirm`);
    assert.equal(res.status, 403);
  });

  test('an admin confirms through the stored procedure', async () => {
    const h = setup({ user: adminUser(), rpc: () => ({ data: true, error: null }) });
    const res = await authed('post', `/api/payments/${ORDER_ID}/confirm`);
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Pembayaran dikonfirmasi');
    assert.deepEqual(h.calls.rpc[0], { fn: 'confirm_payment', params: { p_order_id: ORDER_ID } });
  });

  test('a refusal from the procedure surfaces its own message', async () => {
    setup({
      user: adminUser(),
      rpc: () => ({ data: null, error: { message: 'Pesanan tidak dalam status menunggu pembayaran' } }),
    });
    const res = await authed('post', `/api/payments/${ORDER_ID}/confirm`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Pesanan tidak dalam status menunggu pembayaran');
  });

  test('the customer is emailed once the payment is confirmed', async () => {
    const h = setup({ user: adminUser(), rpc: () => ({ data: true, error: null }) });
    await authed('post', `/api/payments/${ORDER_ID}/confirm`);
    const sent = h.email.of('sendStatusEmail');
    assert.equal(sent.length, 1);
    assert.equal(sent[0], ORDER_ID);
  });
});
