'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

before(() => {
  process.env.API_PUBLIC_URL = 'https://api.example.com';
});

const { rewriteStorageUrl } = require('../../format/storage');

describe('rewriteStorageUrl', () => {
  test('rewrites Supabase public storage URL to proxy path', () => {
    const input = 'https://abc.supabase.co/storage/v1/object/public/module-covers/foo.jpg';
    const expected = 'https://api.example.com/api/storage/v1/object/public/module-covers/foo.jpg';
    assert.equal(rewriteStorageUrl(input), expected);
  });

  test('idempotent — already-rewritten URL returns unchanged', () => {
    const input = 'https://api.example.com/api/storage/v1/object/public/module-covers/foo.jpg';
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

  test('preserves query string', () => {
    const input = 'https://abc.supabase.co/storage/v1/object/sign/foo.jpg?token=abc123';
    const expected = 'https://api.example.com/api/storage/v1/object/sign/foo.jpg?token=abc123';
    assert.equal(rewriteStorageUrl(input), expected);
  });

  test('different supabase subdomain still matches', () => {
    const input = 'https://xyz123.supabase.co/storage/v1/object/public/bucket/path.png';
    assert.equal(
      rewriteStorageUrl(input),
      'https://api.example.com/api/storage/v1/object/public/bucket/path.png'
    );
  });
});
