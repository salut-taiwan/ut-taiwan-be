'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentCart, buildCartTotalBreakdown } = require('../../presenters/cartPresenter');
const { SALUT_FEES } = require('../../config/constants');

const NBSP = '\u00a0';

function makeRawCart(over = {}) {
  return {
    id: 'cart-1',
    userId: 'u-1',
    items: [
      {
        id: 'i-1',
        itemType: 'module',
        moduleId: 'm-1',
        tboCode: 'MKDU4109',
        moduleName: 'Bahasa Inggris',
        coverImageUrl: 'https://abc.supabase.co/storage/v1/object/public/module-covers/foo.jpg',
        quantity: 2,
        priceSnapshot: 50000,
        subtotal: 100000,
        isAvailable: true,
        isRequest: false,
        isStale: false,
        isPricePending: false,
      },
    ],
    subtotal: 100000,
    itemCount: 2,
    hasStaleItems: false,
    ...over,
  };
}

describe('presentCart — per-item displays', () => {
  test('adds priceSnapshotDisplay and subtotalDisplay (IDR, NBSP-separated)', () => {
    const out = presentCart(makeRawCart(), { isSalutActive: false });
    assert.equal(out.items[0].priceSnapshotDisplay, `Rp${NBSP}50.000`);
    assert.equal(out.items[0].subtotalDisplay, `Rp${NBSP}100.000`);
  });

  test('rewrites Supabase storage URL on coverImageUrl', () => {
    const out = presentCart(makeRawCart(), { isSalutActive: false });
    assert.equal(
      out.items[0].coverImageUrl,
      '/api/storage/v1/object/public/module-covers/foo.jpg'
    );
  });

  test('leaves Tokopedia (external) URLs untouched', () => {
    const dto = makeRawCart({
      items: [{ ...makeRawCart().items[0], coverImageUrl: 'https://images.tokopedia.net/foo.jpg' }],
    });
    const out = presentCart(dto, { isSalutActive: false });
    assert.equal(out.items[0].coverImageUrl, 'https://images.tokopedia.net/foo.jpg');
  });

  test('null coverImageUrl stays null', () => {
    const dto = makeRawCart({
      items: [{ ...makeRawCart().items[0], coverImageUrl: null }],
    });
    const out = presentCart(dto, { isSalutActive: false });
    assert.equal(out.items[0].coverImageUrl, null);
  });
});

describe('presentCart — total_breakdown', () => {
  test('non-SALUT user: subtotal + all fees → total', () => {
    const out = presentCart(makeRawCart(), { isSalutActive: false });
    const expected = 100000 + SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN;
    assert.equal(out.subtotal_display, `Rp${NBSP}100.000`);
    assert.equal(out.total_breakdown.subtotal_display, `Rp${NBSP}100.000`);
    assert.equal(out.total_breakdown.total_display, `Rp${NBSP}${expected.toLocaleString('id-ID')}`);
    assert.equal(out.total_breakdown.unique_code_display, null);
    assert.equal(out.total_breakdown.fee_lines.length, 3);
    for (const line of out.total_breakdown.fee_lines) {
      assert.equal(line.is_waived, false);
      assert.equal(line.original_amount, undefined);
    }
  });

  test('SALUT-active user: all fee lines waived, total === subtotal', () => {
    const out = presentCart(makeRawCart(), { isSalutActive: true });
    assert.equal(out.total_breakdown.total_display, `Rp${NBSP}100.000`);
    assert.equal(out.total_breakdown.fee_lines.length, 3);
    for (const line of out.total_breakdown.fee_lines) {
      assert.equal(line.is_waived, true);
      assert.equal(line.amount, 0);
      assert.equal(line.amount_display, `Rp${NBSP}0`);
      assert.ok(line.original_amount > 0, 'original_amount must come from SALUT_FEES constants');
      assert.ok(line.original_amount_display.startsWith('Rp'));
    }
  });

  test('empty cart: subtotal=0, fees still shown for non-SALUT', () => {
    const out = presentCart(makeRawCart({ items: [], subtotal: 0, itemCount: 0 }), { isSalutActive: false });
    const expected = SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN;
    assert.equal(out.subtotal_display, `Rp${NBSP}0`);
    assert.equal(out.total_breakdown.total_display, `Rp${NBSP}${expected.toLocaleString('id-ID')}`);
  });
});

describe('buildCartTotalBreakdown — standalone helper', () => {
  test('returns shape with fee_lines and total when given subtotal', () => {
    const out = buildCartTotalBreakdown({ subtotal: 50000, isSalutActive: false });
    assert.equal(out.subtotal_display, `Rp${NBSP}50.000`);
    assert.equal(out.fee_lines.length, 3);
    assert.ok(out.total_display);
  });

  test('SALUT-active path waives fees', () => {
    const out = buildCartTotalBreakdown({ subtotal: 50000, isSalutActive: true });
    assert.equal(out.total_display, out.subtotal_display);
  });
});
