'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildOrderItemsPayload, buildCustomOrderItems } = require('../../services/orderItemsPayload');

function moduleCartItem(over = {}) {
  return {
    quantity: 2,
    price_snapshot: 50000,
    is_request: false,
    modules: { id: 'm-1', tbo_code: 'MKDU4109', name: 'Bahasa Inggris', is_available: true },
    ...over,
  };
}

function merchCartItem(over = {}) {
  return {
    quantity: 1,
    price_snapshot: 350000,
    is_request: false,
    sku_id: 'sku-1',
    variant_label: 'L',
    product_name_snapshot: 'Jas Almamater UT',
    ...over,
  };
}

describe('buildOrderItemsPayload', () => {
  test('module line carries its columns and cart is_request flag', () => {
    assert.deepEqual(buildOrderItemsPayload([moduleCartItem()]), [{
      quantity: 2,
      unit_price: 50000,
      subtotal: 100000,
      module_id: 'm-1',
      module_code: 'MKDU4109',
      module_name: 'Bahasa Inggris',
      is_request: false,
    }]);
  });

  test('module flagged as a request in the cart stays a request', () => {
    const [item] = buildOrderItemsPayload([moduleCartItem({ is_request: true, price_snapshot: 0 })]);
    assert.equal(item.is_request, true);
    assert.equal(item.unit_price, 0);
    assert.equal(item.subtotal, 0);
  });

  test('paid merch is never a request — its SKU price is known', () => {
    assert.deepEqual(buildOrderItemsPayload([merchCartItem()]), [{
      quantity: 1,
      unit_price: 350000,
      subtotal: 350000,
      module_id: null,
      module_code: null,
      module_name: 'Jas Almamater UT',
      is_request: false,
      sku_id: 'sku-1',
      variant_label: 'L',
    }]);
  });

  test('free SALUT almet is a genuinely free item, not a pending request', () => {
    const [item] = buildOrderItemsPayload([merchCartItem({ price_snapshot: 0, product_name_snapshot: 'Jas Almamater SALUT (Gratis)' })]);
    assert.equal(item.is_request, false);
    assert.equal(item.unit_price, 0);
    assert.equal(item.subtotal, 0);
  });

  test('string price snapshot is coerced, so subtotal is arithmetic not concatenation', () => {
    const [item] = buildOrderItemsPayload([merchCartItem({ price_snapshot: '350000.00', quantity: 2 })]);
    assert.equal(item.unit_price, 350000);
    assert.equal(item.subtotal, 700000);
  });

  test('empty or missing cart yields no items', () => {
    assert.deepEqual(buildOrderItemsPayload([]), []);
    assert.deepEqual(buildOrderItemsPayload(undefined), []);
  });
});

describe('buildCustomOrderItems', () => {
  test('always a request, priced at 0, code trimmed and capped at 30 chars', () => {
    const long = 'X'.repeat(40);
    assert.deepEqual(buildCustomOrderItems([{ moduleCode: `  ${long}  `, moduleName: '  Modul Khusus ', quantity: 3 }]), [{
      module_id: null,
      module_code: 'X'.repeat(30),
      module_name: 'Modul Khusus',
      quantity: 3,
      unit_price: 0,
      subtotal: 0,
      is_request: true,
    }]);
  });

  test('falls back to the code as name and clamps quantity to at least 1', () => {
    const [item] = buildCustomOrderItems([{ moduleCode: 'ABC123', quantity: 0 }]);
    assert.equal(item.module_name, 'ABC123');
    assert.equal(item.quantity, 1);
  });

  test('non-numeric quantity becomes 1', () => {
    const [item] = buildCustomOrderItems([{ moduleCode: 'ABC123', quantity: 'dua' }]);
    assert.equal(item.quantity, 1);
  });

  test('no custom items yields no rows', () => {
    assert.deepEqual(buildCustomOrderItems(undefined), []);
  });
});
