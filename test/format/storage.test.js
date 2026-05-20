'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { rewriteStorageUrl } = require('../../format/storage');

describe('rewriteStorageUrl', () => {
  test('rewrites Supabase public storage URL to relative proxy path', () => {
    const input = 'https://abc.supabase.co/storage/v1/object/public/module-covers/foo.jpg';
    const expected = '/api/storage/v1/object/public/module-covers/foo.jpg';
    assert.equal(rewriteStorageUrl(input), expected);
  });

  test('idempotent — already-rewritten relative path returns unchanged', () => {
    const input = '/api/storage/v1/object/public/module-covers/foo.jpg';
    assert.equal(rewriteStorageUrl(input), input);
  });

  test('passes through external (Tokopedia) URLs unchanged', () => {
    const input = 'https://images.tokopedia.net/img/cache/700/foo.jpg';
    assert.equal(rewriteStorageUrl(input), input);
  });

  test('passes through other non-Supabase URLs unchanged', () => {
    const input = 'https://random.example.org/img.jpg';
    assert.equal(rewriteStorageUrl(input), input);
  });

  test('returns null for null', () => {
    assert.equal(rewriteStorageUrl(null), null);
  });

  test('returns null for undefined', () => {
    assert.equal(rewriteStorageUrl(undefined), null);
  });

  test('returns null for empty string', () => {
    assert.equal(rewriteStorageUrl(''), null);
  });

  test('preserves query string (e.g. signed URLs)', () => {
    const input = 'https://abc.supabase.co/storage/v1/object/sign/foo.jpg?token=abc123';
    const expected = '/api/storage/v1/object/sign/foo.jpg?token=abc123';
    assert.equal(rewriteStorageUrl(input), expected);
  });

  test('different supabase subdomain still matches', () => {
    const input = 'https://xyz123.supabase.co/storage/v1/object/public/bucket/path.png';
    assert.equal(
      rewriteStorageUrl(input),
      '/api/storage/v1/object/public/bucket/path.png'
    );
  });
});
