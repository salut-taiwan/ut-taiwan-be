'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWaNumber } = require('../../format/phone');

describe('normalizeWaNumber', () => {
  test('Indonesian local 08… becomes 628…', () => {
    assert.equal(normalizeWaNumber('081234567890'), '6281234567890');
  });

  test('Taiwanese local 09… becomes 8869…', () => {
    assert.equal(normalizeWaNumber('0912345678'), '886912345678');
  });

  test('already international, with or without +', () => {
    assert.equal(normalizeWaNumber('+6281234567890'), '6281234567890');
    assert.equal(normalizeWaNumber('6281234567890'), '6281234567890');
  });

  test('strips spaces, dashes and parentheses', () => {
    assert.equal(normalizeWaNumber('+62 (812) 3456-7890'), '6281234567890');
  });

  test('an explicit + is trusted: no local-prefix rewriting', () => {
    assert.equal(normalizeWaNumber('+886912345678'), '886912345678');
  });

  test('too short, too long, empty and non-string inputs are rejected', () => {
    assert.equal(normalizeWaNumber('0812'), null);
    assert.equal(normalizeWaNumber('6'.repeat(16)), null);
    assert.equal(normalizeWaNumber('   '), null);
    assert.equal(normalizeWaNumber(''), null);
    assert.equal(normalizeWaNumber(null), null);
    assert.equal(normalizeWaNumber(undefined), null);
    assert.equal(normalizeWaNumber(628123456789), null);
  });

  test('text with no digits is rejected', () => {
    assert.equal(normalizeWaNumber('tidak punya'), null);
  });
});
