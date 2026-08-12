'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateUpload,
  extFromMime,
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
} = require('../../utils/validateUpload');

const file = (over = {}) => ({ mimetype: 'image/jpeg', size: 1024, ...over });

describe('validateUpload', () => {
  test('a missing file reports the default message', () => {
    assert.equal(validateUpload(undefined), 'File wajib diunggah');
    assert.equal(validateUpload(null), 'File wajib diunggah');
  });

  test('a caller-supplied message replaces the default', () => {
    assert.equal(
      validateUpload(undefined, 'File bukti pembayaran wajib diunggah'),
      'File bukti pembayaran wajib diunggah',
    );
  });

  test('each allowed type passes', () => {
    for (const mimetype of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      assert.equal(validateUpload(file({ mimetype })), null, `${mimetype} should be allowed`);
    }
  });

  test('a disallowed type is refused with the format message', () => {
    for (const mimetype of ['image/gif', 'image/svg+xml', 'text/html', 'application/octet-stream']) {
      assert.equal(
        validateUpload(file({ mimetype })),
        'Format file tidak didukung (JPG, PNG, WebP, atau PDF)',
        `${mimetype} should be refused`,
      );
    }
  });

  test('an svg is refused — it can carry script', () => {
    assert.ok(validateUpload(file({ mimetype: 'image/svg+xml' })));
  });

  test('exactly 5 MB is accepted and one byte more is refused', () => {
    assert.equal(validateUpload(file({ size: MAX_SIZE_BYTES })), null);
    assert.equal(validateUpload(file({ size: MAX_SIZE_BYTES + 1 })), 'Ukuran file maksimal 5 MB');
  });

  test('type is checked before size — a huge gif reports the format problem', () => {
    assert.equal(
      validateUpload(file({ mimetype: 'image/gif', size: MAX_SIZE_BYTES * 10 })),
      'Format file tidak didukung (JPG, PNG, WebP, atau PDF)',
    );
  });

  test('a zero-byte file of an allowed type passes', () => {
    assert.equal(validateUpload(file({ size: 0 })), null);
  });
});

describe('extFromMime', () => {
  test('maps every allowed type to its short extension', () => {
    assert.equal(extFromMime('image/jpeg'), 'jpg');
    assert.equal(extFromMime('image/png'), 'png');
    assert.equal(extFromMime('image/webp'), 'webp');
    assert.equal(extFromMime('application/pdf'), 'pdf');
  });

  test('an unknown type falls back to bin rather than producing "undefined"', () => {
    assert.equal(extFromMime('image/gif'), 'bin');
    assert.equal(extFromMime(undefined), 'bin');
    assert.equal(extFromMime(''), 'bin');
  });
});

describe('exported limits', () => {
  test('the cap is 5 MB — half of what multer accepts, so the two must be read together', () => {
    // middleware/upload.js allows 10 MB. Routes that use multer without also
    // calling validateUpload therefore accept files this module would refuse.
    assert.equal(MAX_SIZE_BYTES, 5 * 1024 * 1024);
  });

  test('exactly four types are allowed', () => {
    assert.equal(ALLOWED_MIME_TYPES.size, 4);
    assert.deepEqual(
      [...ALLOWED_MIME_TYPES].sort(),
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    );
  });
});
