'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { formatDate, formatExpiryDate } = require('../../format/datetime');

describe('formatDate (default Asia/Taipei)', () => {
  test('formats ISO string in Asia/Taipei (UTC+8)', () => {
    // 2026-05-20T06:30:00Z = 14:30 in Taipei
    const out = formatDate('2026-05-20T06:30:00Z');
    assert.equal(out, '20 Mei 2026 pukul 14.30');
  });

  test('formats midnight UTC into Taipei early morning', () => {
    // 2026-05-20T00:00:00Z = 08:00 in Taipei
    const out = formatDate('2026-05-20T00:00:00Z');
    assert.equal(out, '20 Mei 2026 pukul 08.00');
  });

  test('returns null for null', () => {
    assert.equal(formatDate(null), null);
  });

  test('returns null for undefined', () => {
    assert.equal(formatDate(undefined), null);
  });

  test('returns null for empty string', () => {
    assert.equal(formatDate(''), null);
  });

  test('returns null for invalid date string (no "Invalid Date" leak)', () => {
    assert.equal(formatDate('not-a-date'), null);
  });
});

describe('formatDate with timeZone option (Asia/Jakarta for emails)', () => {
  test('formats ISO string in Asia/Jakarta (UTC+7)', () => {
    // 2026-05-20T06:30:00Z = 13:30 in Jakarta
    const out = formatDate('2026-05-20T06:30:00Z', { timeZone: 'Asia/Jakarta' });
    assert.equal(out, '20 Mei 2026 pukul 13.30');
  });
});

describe('formatExpiryDate (Asia/Taipei, no time component)', () => {
  test('formats date-only string', () => {
    const out = formatExpiryDate('2027-05-01T00:00:00+08:00');
    assert.equal(out, '1 Mei 2027');
  });

  test('returns null for null', () => {
    assert.equal(formatExpiryDate(null), null);
  });

  test('returns null for invalid date', () => {
    assert.equal(formatExpiryDate('bad'), null);
  });
});
