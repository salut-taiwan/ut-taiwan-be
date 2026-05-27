'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentFees } = require('../../presenters/feesPresenter');
const { SALUT_FEES, SALUT_MEMBERSHIP } = require('../../config/constants');

const NBSP = '\u00a0';

function makeRawFees() {
  return {
    salutMembership: {
      currency: SALUT_MEMBERSHIP.CURRENCY,
      new: SALUT_MEMBERSHIP.PRICE_NEW,
      returning: SALUT_MEMBERSHIP.PRICE_RETURNING,
      rule: 'new = current_semester === 1',
      renewalPolicy: {
        resetMonth: 5,
        resetDay: 1,
        timezone: 'Asia/Taipei',
        notice: 'test',
      },
    },
    serviceFees: [
      { label: 'Ongkir',      key: 'shipping', amount: SALUT_FEES.ONGKIR },
      { label: 'Biaya Box',   key: 'box',      amount: SALUT_FEES.BOX },
      { label: 'Biaya Admin', key: 'admin',    amount: SALUT_FEES.ADMIN },
    ],
    totalServiceFees: SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN,
    serviceFeesCurrency: 'IDR',
    paymentBank: {
      bank: 'BCA',
      account: '2950211345',
      holder: 'Nathasya Vira Nerisa',
    },
  };
}

describe('presentFees', () => {
  test('adds NTD display strings for salutMembership new/returning', () => {
    const out = presentFees(makeRawFees());
    assert.equal(out.salutMembership.new_display, 'NT$ 1,700');
    assert.equal(out.salutMembership.returning_display, 'NT$ 1,200');
  });

  test('adds tier labels', () => {
    const out = presentFees(makeRawFees());
    assert.equal(out.salutMembership.new_label, 'NT$ 1,700 (semester 1)');
    assert.equal(out.salutMembership.returning_label, 'NT$ 1,200 (semester 2+)');
  });

  test('adds tier_combined_display matching frontend salut/page.tsx:18-20 format', () => {
    const out = presentFees(makeRawFees());
    assert.equal(
      out.salutMembership.tier_combined_display,
      'NT$ 1,700 (semester 1) atau NT$ 1,200 (semester 2+)'
    );
  });

  test('adds amount_display to each serviceFees entry (NBSP-separated Rp)', () => {
    const out = presentFees(makeRawFees());
    assert.equal(out.serviceFees[0].amount_display, `Rp${NBSP}300.000`);
    assert.equal(out.serviceFees[1].amount_display, `Rp${NBSP}100.000`);
    assert.equal(out.serviceFees[2].amount_display, `Rp${NBSP}25.000`);
  });

  test('adds totalServiceFees_display', () => {
    const out = presentFees(makeRawFees());
    assert.equal(out.totalServiceFees_display, `Rp${NBSP}425.000`);
  });

  test('preserves raw fields (additive contract)', () => {
    const raw = makeRawFees();
    const out = presentFees(raw);
    assert.equal(out.salutMembership.new, 1700);
    assert.equal(out.salutMembership.returning, 1200);
    assert.equal(out.serviceFees[0].amount, SALUT_FEES.ONGKIR);
    assert.equal(out.totalServiceFees, SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN);
  });

  test('passes paymentBank through unchanged', () => {
    const raw = makeRawFees();
    const out = presentFees(raw);
    assert.deepEqual(out.paymentBank, {
      bank: 'BCA',
      account: '2950211345',
      holder: 'Nathasya Vira Nerisa',
    });
  });
});
