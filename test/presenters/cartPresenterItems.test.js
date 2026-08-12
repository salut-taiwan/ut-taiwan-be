'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// The existing cartPresenter.test.js covers presentCart and the total
// breakdown. These are the exports it never imports directly.
const { presentCartItem, buildFeeLines } = require('../../presenters/cartPresenter');
const { SALUT_FEES } = require('../../config/constants');

const NBSP = '\u00a0';
const SUPABASE_URL = 'https://project.supabase.co/storage/v1/object/public/module-covers/c.jpg';

const item = (over = {}) => ({
  id: 'ci-1',
  itemType: 'module',
  moduleName: 'Bahasa Inggris',
  coverImageUrl: SUPABASE_URL,
  quantity: 2,
  priceSnapshot: 50000,
  subtotal: 100000,
  isRequest: false,
  ...over,
});

describe('presentCartItem', () => {
  test('rewrites the cover image to the proxy path', () => {
    assert.ok(presentCartItem(item()).coverImageUrl.startsWith('/api/storage/'));
  });

  test('a missing cover image stays null', () => {
    assert.equal(presentCartItem(item({ coverImageUrl: null })).coverImageUrl, null);
  });

  test('every other field is preserved', () => {
    const out = presentCartItem(item());
    assert.equal(out.id, 'ci-1');
    assert.equal(out.itemType, 'module');
    assert.equal(out.quantity, 2);
    assert.equal(out.isRequest, false);
  });

  test('prices render as IDR', () => {
    const out = presentCartItem(item());
    assert.equal(out.priceSnapshotDisplay, `Rp${NBSP}50.000`);
    assert.equal(out.subtotalDisplay, `Rp${NBSP}100.000`);
  });

  test('a genuinely free line reads "Gratis" on both the unit price and the subtotal', () => {
    const out = presentCartItem(item({ priceSnapshot: 0, subtotal: 0 }));
    assert.equal(out.priceSnapshotDisplay, 'Gratis');
    assert.equal(out.subtotalDisplay, 'Gratis');
  });

  test('a numeric-string snapshot is coerced, so "0.00" is free rather than truthy', () => {
    const out = presentCartItem(item({ priceSnapshot: '0.00', subtotal: '0.00' }));
    assert.equal(out.priceSnapshotDisplay, 'Gratis');
    assert.equal(out.subtotalDisplay, 'Gratis');
  });

  test('a merch line keeps its variant label and product name', () => {
    const out = presentCartItem(item({
      itemType: 'merch',
      skuId: 'sku-1',
      variantLabel: 'L / Navy',
      productNameSnapshot: 'Jas Almamater',
    }));
    assert.equal(out.itemType, 'merch');
    assert.equal(out.variantLabel, 'L / Navy');
    assert.equal(out.productNameSnapshot, 'Jas Almamater');
  });
});

describe('cartPresenter.buildFeeLines', () => {
  test('amounts always come from SALUT_FEES — a cart cannot influence the fees shown', () => {
    const lines = buildFeeLines({ isSalutActive: false });
    assert.deepEqual(lines.map(l => l.amount), [SALUT_FEES.ONGKIR, SALUT_FEES.BOX, SALUT_FEES.ADMIN]);
  });

  test('an active member sees every fee waived to zero', () => {
    const lines = buildFeeLines({ isSalutActive: true });
    for (const line of lines) {
      assert.equal(line.amount, 0);
      assert.equal(line.is_waived, true);
    }
  });

  test('the waived lines keep the original amounts for the strikethrough', () => {
    const lines = buildFeeLines({ isSalutActive: true });
    assert.deepEqual(
      lines.map(l => l.original_amount),
      [SALUT_FEES.ONGKIR, SALUT_FEES.BOX, SALUT_FEES.ADMIN],
    );
  });

  test('the three lines are always shipping, box and admin in that order', () => {
    assert.deepEqual(buildFeeLines({ isSalutActive: false }).map(l => l.key), ['shipping', 'box', 'admin']);
  });
});
