'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { deriveModuleCartEntry } = require('../../services/cartPricing');

function mod(over = {}) {
  return { id: 'm-1', price_student: 50000, is_available: true, ...over };
}

describe('deriveModuleCartEntry', () => {
  test('priced and in stock: normal purchasable line', () => {
    assert.deepEqual(deriveModuleCartEntry(mod()), { priceSnapshot: 50000, isRequest: false });
  });

  test('priced but out of stock: request, price kept for reference', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ is_available: false })),
      { priceSnapshot: 50000, isRequest: true },
    );
  });

  test('no price yet (null): request at 0', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ price_student: null })),
      { priceSnapshot: 0, isRequest: true },
    );
  });

  test('price 0 is "not priced yet", not free', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ price_student: 0 })),
      { priceSnapshot: 0, isRequest: true },
    );
  });

  test('string "0.00" from a raw query is still zero, not truthy', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ price_student: '0.00' })),
      { priceSnapshot: 0, isRequest: true },
    );
  });

  test('string price is coerced to a number', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ price_student: '50000.00' })),
      { priceSnapshot: 50000, isRequest: false },
    );
  });

  test('missing module: request at 0 rather than a crash', () => {
    assert.deepEqual(deriveModuleCartEntry(undefined), { priceSnapshot: 0, isRequest: true });
  });

  test('unparseable price falls back to 0', () => {
    assert.deepEqual(
      deriveModuleCartEntry(mod({ price_student: 'abc' })),
      { priceSnapshot: 0, isRequest: true },
    );
  });
});
