'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  getSalutMembershipFee,
  quoteNtdFromIdr,
  RATE_IDR_PER_NTD,
  SALUT_MEMBERSHIP,
  ORDER_STATUS_TRANSITIONS,
  SALUT_FEES,
} = require('../../config/constants');

describe('getSalutMembershipFee', () => {
  test('semester 1 pays the new-member tier', () => {
    const fee = getSalutMembershipFee(1);
    assert.equal(fee.amount, 1700);
    assert.equal(fee.currency, 'NTD');
    assert.equal(fee.tier, 'new');
  });

  test('semesters 2 through 9 pay the returning tier', () => {
    for (let sem = 2; sem <= 9; sem++) {
      const fee = getSalutMembershipFee(sem);
      assert.equal(fee.amount, 1200, `semester ${sem}`);
      assert.equal(fee.tier, 'returning', `semester ${sem}`);
    }
  });

  test('the IDR figure is what students actually transfer over QRIS', () => {
    assert.equal(getSalutMembershipFee(1).amount_idr, 952000);
    assert.equal(getSalutMembershipFee(3).amount_idr, 672000);
  });

  test('the IDR figure is always the NTD amount at the published rate', () => {
    for (const sem of [1, 5]) {
      const fee = getSalutMembershipFee(sem);
      assert.equal(fee.amount_idr, fee.amount * RATE_IDR_PER_NTD);
    }
  });

  test('the semester must be a number — the string "1" falls to the returning tier', () => {
    // Strict === 1 comparison. Locked so callers keep coercing before calling.
    assert.equal(getSalutMembershipFee('1').tier, 'returning');
  });

  test('an absent semester falls to the returning tier rather than throwing', () => {
    assert.equal(getSalutMembershipFee(undefined).tier, 'returning');
    assert.equal(getSalutMembershipFee(null).tier, 'returning');
  });

  test('the tier prices come from SALUT_MEMBERSHIP, not hardcoded twice', () => {
    assert.equal(getSalutMembershipFee(1).amount, SALUT_MEMBERSHIP.PRICE_NEW);
    assert.equal(getSalutMembershipFee(2).amount, SALUT_MEMBERSHIP.PRICE_RETURNING);
  });
});

describe('quoteNtdFromIdr', () => {
  test('an exact multiple of the rate converts cleanly', () => {
    assert.deepEqual(quoteNtdFromIdr(560), { idr_amount: 560, ntd_amount: 1, rate_idr_per_ntd: 560 });
  });

  test('a remainder always rounds up, so SALUT is never short-changed', () => {
    assert.equal(quoteNtdFromIdr(561).ntd_amount, 2);
    assert.equal(quoteNtdFromIdr(1119).ntd_amount, 2);
    assert.equal(quoteNtdFromIdr(1120).ntd_amount, 2);
  });

  test('a numeric string is coerced', () => {
    assert.equal(quoteNtdFromIdr('5600').ntd_amount, 10);
  });

  test('a non-positive or unusable amount yields no quote', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, null, undefined, 'abc', '']) {
      assert.equal(quoteNtdFromIdr(bad), null, `${String(bad)} should not quote`);
    }
  });

  test('the quote echoes the rate it used, so the UI never re-derives it', () => {
    assert.equal(quoteNtdFromIdr(5600).rate_idr_per_ntd, RATE_IDR_PER_NTD);
  });

  test('a large realistic tuition amount converts without precision loss', () => {
    assert.deepEqual(quoteNtdFromIdr(5600000), {
      idr_amount: 5600000,
      ntd_amount: 10000,
      rate_idr_per_ntd: 560,
    });
  });
});

describe('exported money constants', () => {
  test('one published rate serves both SKS quotes and the SALUT fee', () => {
    assert.equal(RATE_IDR_PER_NTD, 560);
  });

  test('service fees are 300.000 / 100.000 / 25.000', () => {
    assert.deepEqual(SALUT_FEES, { ONGKIR: 300000, BOX: 100000, ADMIN: 25000 });
  });
});

describe('ORDER_STATUS_TRANSITIONS', () => {
  test('an order walks pending → awaiting_payment → paid → processing/shipped → delivered', () => {
    assert.deepEqual(ORDER_STATUS_TRANSITIONS.pending, ['awaiting_payment']);
    assert.deepEqual(ORDER_STATUS_TRANSITIONS.awaiting_payment, ['paid']);
    assert.deepEqual(ORDER_STATUS_TRANSITIONS.paid, ['processing', 'shipped']);
    assert.deepEqual(ORDER_STATUS_TRANSITIONS.processing, ['shipped']);
    assert.deepEqual(ORDER_STATUS_TRANSITIONS.shipped, ['delivered']);
  });

  test('delivered and cancelled are terminal — no transition table entry at all', () => {
    assert.equal(ORDER_STATUS_TRANSITIONS.delivered, undefined);
    assert.equal(ORDER_STATUS_TRANSITIONS.cancelled, undefined);
  });

  test('payment can never be confirmed before stock is confirmed', () => {
    // 'paid' is reachable only from 'awaiting_payment', which is reachable only
    // from 'pending' via the Karunika confirmation.
    const reachesPaid = Object.entries(ORDER_STATUS_TRANSITIONS)
      .filter(([, next]) => next.includes('paid'))
      .map(([from]) => from);
    assert.deepEqual(reachesPaid, ['awaiting_payment']);
  });
});
