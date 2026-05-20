'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  STEP_LABELS,
  REQUEST_STATUS_LABELS,
  getOrderStatusLabel,
  getPaymentStatusLabel,
  getStepLabel,
  getRequestStatusLabel,
} = require('../../format/labels');

describe('getOrderStatusLabel', () => {
  test('maps awaiting_payment', () => {
    assert.equal(getOrderStatusLabel('awaiting_payment'), 'Menunggu Pembayaran');
  });

  test('maps pending', () => {
    assert.equal(getOrderStatusLabel('pending'), 'Menunggu Konfirmasi Karunika');
  });

  test('maps delivered', () => {
    assert.equal(getOrderStatusLabel('delivered'), 'Terkirim');
  });

  test('returns null for unknown status (no enum echo)', () => {
    assert.equal(getOrderStatusLabel('unknown_status'), null);
  });

  test('returns null for null input', () => {
    assert.equal(getOrderStatusLabel(null), null);
  });

  test('covers all ORDER_STEPS keys', () => {
    const keys = ['pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'];
    for (const k of keys) assert.ok(getOrderStatusLabel(k), `missing label for ${k}`);
  });

  test('covers cancelled too', () => {
    assert.equal(getOrderStatusLabel('cancelled'), 'Dibatalkan');
  });
});

describe('getPaymentStatusLabel', () => {
  test('maps paid', () => {
    assert.equal(getPaymentStatusLabel('paid'), 'Lunas');
  });

  test('maps pending', () => {
    assert.equal(getPaymentStatusLabel('pending'), 'Menunggu Pembayaran');
  });

  test('returns null for unknown', () => {
    assert.equal(getPaymentStatusLabel('weird'), null);
  });
});

describe('STEP_LABELS', () => {
  test('all six order steps have labels', () => {
    const steps = ['pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'];
    for (const s of steps) {
      assert.ok(STEP_LABELS[s], `missing step label for ${s}`);
    }
  });

  test('getStepLabel returns null for unknown', () => {
    assert.equal(getStepLabel('xyz'), null);
  });
});

describe('REQUEST_STATUS_LABELS', () => {
  test('maps pending, approved, rejected', () => {
    assert.ok(getRequestStatusLabel('pending'));
    assert.ok(getRequestStatusLabel('approved'));
    assert.ok(getRequestStatusLabel('rejected'));
  });

  test('returns null for null', () => {
    assert.equal(getRequestStatusLabel(null), null);
  });
});
