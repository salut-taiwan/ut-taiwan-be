'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { formatIDR, formatNTD } = require('../../format/currency');

// NBSP between "Rp" and number is what Intl produces in id-ID. We preserve it
// for byte-for-byte parity with the existing frontend output (which is what
// users actually see).
const NBSP = '\u00a0';

describe('formatIDR', () => {
  test('formats 425000 with Indonesian thousands separator', () => {
    assert.equal(formatIDR(425000), `Rp${NBSP}425.000`);
  });

  test('formats 0', () => {
    assert.equal(formatIDR(0), `Rp${NBSP}0`);
  });

  test('formats 1234567', () => {
    assert.equal(formatIDR(1234567), `Rp${NBSP}1.234.567`);
  });

  test('returns null for null', () => {
    assert.equal(formatIDR(null), null);
  });

  test('returns null for undefined', () => {
    assert.equal(formatIDR(undefined), null);
  });

  test('does not produce fraction digits', () => {
    assert.equal(formatIDR(100.99), `Rp${NBSP}101`);
  });

  test('parity for representative amounts', () => {
    assert.equal(formatIDR(100), `Rp${NBSP}100`);
    assert.equal(formatIDR(1000), `Rp${NBSP}1.000`);
    assert.equal(formatIDR(10000), `Rp${NBSP}10.000`);
    assert.equal(formatIDR(100000), `Rp${NBSP}100.000`);
    assert.equal(formatIDR(300000), `Rp${NBSP}300.000`);
    assert.equal(formatIDR(25000), `Rp${NBSP}25.000`);
  });
});

describe('formatNTD', () => {
  // Manual "NT$ " prefix + toLocaleString — regular space, matching frontend
  // template literals in app/salut/page.tsx:19,116,118 etc.
  test('formats 1700', () => {
    assert.equal(formatNTD(1700), 'NT$ 1,700');
  });

  test('formats 1200', () => {
    assert.equal(formatNTD(1200), 'NT$ 1,200');
  });

  test('formats 0', () => {
    assert.equal(formatNTD(0), 'NT$ 0');
  });

  test('returns null for null', () => {
    assert.equal(formatNTD(null), null);
  });

  test('returns null for undefined', () => {
    assert.equal(formatNTD(undefined), null);
  });
});
