'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, stubBackend, studentUser, freshIp } = require('../helpers/testApp');
const upload = require('../../middleware/upload');
const { MAX_SIZE_BYTES, ALLOWED_MIME_TYPES } = require('../../utils/validateUpload');

const ROUTE = '/api/salut/upload-proof';

let harness = null;
afterEach(() => { harness?.restore(); harness = null; });

const post = () =>
  request(app).post(ROUTE).set('X-Forwarded-For', freshIp()).set('Authorization', 'Bearer t');

describe('upload fileFilter — configuration', () => {
  test('every allowed type is accepted', () => {
    for (const mimetype of ALLOWED_MIME_TYPES) {
      let result;
      upload.fileFilter?.({}, { mimetype }, (err, ok) => { result = { err, ok }; });
      assert.equal(result.err, null, `${mimetype} should pass`);
      assert.equal(result.ok, true);
    }
  });

  test('a disallowed type reports a 400-shaped error instead of being dropped silently', () => {
    // A bare cb(null, false) leaves req.file undefined and the controller then
    // tells someone who did attach a file that a file is required.
    let captured;
    upload.fileFilter?.({}, { mimetype: 'image/gif' }, (err) => { captured = err; });
    assert.ok(captured instanceof Error);
    assert.equal(captured.status, 400);
    assert.match(captured.message, /Format file tidak didukung/);
  });

  test('the size limit matches utils/validateUpload — the two used to disagree', () => {
    assert.equal(upload.limits.fileSize, MAX_SIZE_BYTES);
    assert.equal(upload.limits.fileSize, 5 * 1024 * 1024);
  });
});

describe('upload over a real route', () => {
  test('an allowed file reaches the handler', async () => {
    harness = stubBackend({ user: studentUser() });
    const res = await post().attach('proof', Buffer.from('hello'), {
      filename: 'bukti.png',
      contentType: 'image/png',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.url);
  });

  test('a disallowed type is a 400 naming the problem, not a generic "file required"', async () => {
    harness = stubBackend({ user: studentUser() });
    const res = await post().attach('proof', Buffer.from('GIF89a'), {
      filename: 'sneaky.gif',
      contentType: 'image/gif',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Format file tidak didukung/);
  });

  test('an oversized file is a 400 about the size, not a 500', async () => {
    // Multer raises a MulterError with no .status; unmapped it became a 500.
    harness = stubBackend({ user: studentUser() });
    const res = await post().attach('proof', Buffer.alloc(MAX_SIZE_BYTES + 1024), {
      filename: 'huge.pdf',
      contentType: 'application/pdf',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Ukuran file maksimal 5 MB');
  });

  test('a request with no file at all still reports that one is required', async () => {
    harness = stubBackend({ user: studentUser() });
    const res = await post();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'File bukti pembayaran wajib diunggah');
  });

  test('a file just under the cap is accepted', async () => {
    harness = stubBackend({ user: studentUser() });
    const res = await post().attach('proof', Buffer.alloc(MAX_SIZE_BYTES - 1024), {
      filename: 'big.pdf',
      contentType: 'application/pdf',
    });
    assert.equal(res.status, 200);
  });
});
