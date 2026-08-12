'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { listBanks, getBankName } = require('../../config/banks');

// This module is the only validator between the registration form and the bank
// columns: authController rejects unknown codes and overwrites the client's
// bank name with the canonical one resolved here.

describe('listBanks', () => {
  test('NTD entries expose a numeric code, a name, and a "code — name" label', () => {
    const banks = listBanks('NTD');
    assert.ok(banks.length > 0);
    for (const b of banks) {
      assert.equal(b.display_label, `${b.code} — ${b.name}`);
      assert.match(b.code, /^\d{3,4}$/);
      assert.ok(b.name.length > 0);
    }
  });

  test('IDR entries have no separate code — the name is the identifier', () => {
    const banks = listBanks('IDR');
    assert.ok(banks.length > 0);
    for (const b of banks) {
      assert.equal(b.code, b.name);
      assert.equal(b.display_label, b.name);
    }
  });

  test('currency matching is exact and case-sensitive', () => {
    assert.equal(listBanks('ntd'), null);
    assert.equal(listBanks('idr'), null);
    assert.equal(listBanks('USD'), null);
    assert.equal(listBanks(''), null);
    assert.equal(listBanks(undefined), null);
  });

  test('NTD codes are unique — a duplicated code would make getBankName ambiguous', () => {
    const codes = listBanks('NTD').map(b => b.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  test('IDR names are unique', () => {
    const names = listBanks('IDR').map(b => b.name);
    assert.equal(new Set(names).size, names.length);
  });

  test('no entry has a blank name', () => {
    for (const currency of ['NTD', 'IDR']) {
      for (const b of listBanks(currency)) assert.ok(b.name.trim().length > 0);
    }
  });
});

describe('getBankName', () => {
  test('resolves a known NTD code to its canonical name', () => {
    assert.equal(getBankName('004', 'NTD'), 'Bank of Taiwan (臺灣銀行)');
  });

  test('an unknown NTD code is refused rather than echoed back', () => {
    assert.equal(getBankName('999999', 'NTD'), null);
  });

  test('a valid code under the wrong currency is refused', () => {
    assert.equal(getBankName('004', 'IDR'), null);
  });

  test('a known IDR bank name resolves to itself', () => {
    const [first] = listBanks('IDR');
    assert.equal(getBankName(first.name, 'IDR'), first.name);
  });

  test('an IDR name differing only by case is refused — matching is exact', () => {
    const [first] = listBanks('IDR');
    assert.equal(getBankName(first.name.toLowerCase(), 'IDR'), null);
  });

  test('an empty or missing code returns null without throwing', () => {
    assert.equal(getBankName('', 'NTD'), null);
    assert.equal(getBankName(null, 'NTD'), null);
    assert.equal(getBankName(undefined, 'IDR'), null);
  });

  test('an unknown currency returns null', () => {
    assert.equal(getBankName('004', 'USD'), null);
  });

  test('every listed NTD bank round-trips code → name', () => {
    for (const b of listBanks('NTD')) {
      assert.equal(getBankName(b.code, 'NTD'), b.name, `NTD ${b.code} should round-trip`);
    }
  });

  test('every listed IDR bank round-trips name → name', () => {
    for (const b of listBanks('IDR')) {
      assert.equal(getBankName(b.name, 'IDR'), b.name, `IDR ${b.name} should round-trip`);
    }
  });
});
