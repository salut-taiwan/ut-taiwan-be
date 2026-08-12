'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// currency.test.js covers formatIDR and formatNTD but never imports this one,
// so the "Gratis" branch was only ever exercised through presenters.
const { formatPriceOrFree } = require('../../format/currency');

const NBSP = '\u00a0';

describe('formatPriceOrFree', () => {
  test('zero reads as "Gratis" — this is what makes the free SALUT almet legible', () => {
    assert.equal(formatPriceOrFree(0), 'Gratis');
  });

  test('a numeric-string zero is also free', () => {
    // numeric(12,2) columns read outside drizzle's mapping arrive as "0.00",
    // which is truthy — the exact shape behind the pricing bug this suite guards.
    assert.equal(formatPriceOrFree('0'), 'Gratis');
    assert.equal(formatPriceOrFree('0.00'), 'Gratis');
    assert.equal(formatPriceOrFree('0.000'), 'Gratis');
  });

  test('a positive amount renders as rupiah with no decimals', () => {
    assert.equal(formatPriceOrFree(350000), `Rp${NBSP}350.000`);
    assert.equal(formatPriceOrFree('350000.00'), `Rp${NBSP}350.000`);
  });

  test('fractional rupiah is rounded away — the currency has no cents in practice', () => {
    assert.equal(formatPriceOrFree(1500.4), `Rp${NBSP}1.500`);
    assert.equal(formatPriceOrFree(1500.6), `Rp${NBSP}1.501`);
  });

  test('null and undefined yield null so a caller can omit the field', () => {
    assert.equal(formatPriceOrFree(null), null);
    assert.equal(formatPriceOrFree(undefined), null);
  });

  test('an unparseable value yields null rather than "Rp NaN"', () => {
    assert.equal(formatPriceOrFree('abc'), null);
    assert.equal(formatPriceOrFree(NaN), null);
    assert.equal(formatPriceOrFree(Infinity), null);
  });

  test('a negative amount still formats, carrying its sign', () => {
    // No caller should produce one; locked so a refund feature sees real output.
    const out = formatPriceOrFree(-5000);
    assert.ok(out.includes('5.000'));
    assert.notEqual(out, 'Gratis');
  });

  test('an empty string is treated as zero by Number() and reads as free', () => {
    assert.equal(formatPriceOrFree(''), 'Gratis');
  });
});
