'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildFeeLines, FEE_LINE_DEFS } = require('../../presenters/feeLines');
const { SALUT_FEES } = require('../../config/constants');

const NBSP = '\u00a0';

describe('buildFeeLines — charged (non-SALUT)', () => {
  test('echoes the amounts passed in, in shipping/box/admin order', () => {
    const lines = buildFeeLines({ amounts: [300000, 100000, 25000], isSalut: false });
    assert.deepEqual(lines.map(l => l.key), ['shipping', 'box', 'admin']);
    assert.deepEqual(lines.map(l => l.amount), [300000, 100000, 25000]);
  });

  test('renders each amount as IDR', () => {
    const [shipping] = buildFeeLines({ amounts: [300000, 0, 0], isSalut: false });
    assert.equal(shipping.amount_display, `Rp${NBSP}300.000`);
  });

  test('a null, undefined or unparseable amount degrades to 0 rather than NaN', () => {
    const lines = buildFeeLines({ amounts: [null, undefined, 'abc'], isSalut: false });
    assert.deepEqual(lines.map(l => l.amount), [0, 0, 0]);
    for (const line of lines) assert.equal(line.amount_display, `Rp${NBSP}0`);
  });

  test('a numeric string amount is coerced', () => {
    const [shipping] = buildFeeLines({ amounts: ['300000.00', 0, 0], isSalut: false });
    assert.equal(shipping.amount, 300000);
  });

  test('carries no original_amount key at all — the frontend branches on its absence', () => {
    for (const line of buildFeeLines({ amounts: [300000, 100000, 25000], isSalut: false })) {
      assert.equal(line.is_waived, false);
      assert.ok(!('original_amount' in line));
      assert.ok(!('original_amount_display' in line));
    }
  });
});

describe('buildFeeLines — waived (SALUT)', () => {
  test('every line is charged 0 and flagged waived', () => {
    const lines = buildFeeLines({ amounts: [300000, 100000, 25000], isSalut: true });
    for (const line of lines) {
      assert.equal(line.amount, 0);
      assert.equal(line.amount_display, `Rp${NBSP}0`);
      assert.equal(line.is_waived, true);
    }
  });

  test('the struck-through original comes from SALUT_FEES, not from the amounts passed in', () => {
    // A member whose order stored 0 fees still shows the discount, and a
    // de-SALUTed user's historical order keeps its strikethrough.
    const lines = buildFeeLines({ amounts: [0, 0, 0], isSalut: true });
    assert.deepEqual(
      lines.map(l => l.original_amount),
      [SALUT_FEES.ONGKIR, SALUT_FEES.BOX, SALUT_FEES.ADMIN],
    );
  });

  test('a tampered amounts array cannot inflate the displayed discount', () => {
    const lines = buildFeeLines({ amounts: [999999999, 999999999, 999999999], isSalut: true });
    assert.deepEqual(
      lines.map(l => l.original_amount),
      [SALUT_FEES.ONGKIR, SALUT_FEES.BOX, SALUT_FEES.ADMIN],
    );
  });

  test('the original is IDR-formatted for display', () => {
    const [shipping] = buildFeeLines({ amounts: [], isSalut: true });
    assert.equal(shipping.original_amount_display, `Rp${NBSP}300.000`);
  });

  test('a missing amounts array is harmless — waived lines never read it', () => {
    const lines = buildFeeLines({ amounts: [], isSalut: true });
    assert.equal(lines.length, 3);
  });
});

describe('FEE_LINE_DEFS', () => {
  test('keys, labels and originals are the frozen contract both cart and order render', () => {
    assert.deepEqual(FEE_LINE_DEFS, [
      { key: 'shipping', label: 'Ongkir', original: SALUT_FEES.ONGKIR },
      { key: 'box', label: 'Biaya Box', original: SALUT_FEES.BOX },
      { key: 'admin', label: 'Biaya Admin', original: SALUT_FEES.ADMIN },
    ]);
  });

  test('the canonical amounts are 300.000 / 100.000 / 25.000', () => {
    assert.equal(SALUT_FEES.ONGKIR, 300000);
    assert.equal(SALUT_FEES.BOX, 100000);
    assert.equal(SALUT_FEES.ADMIN, 25000);
  });
});
