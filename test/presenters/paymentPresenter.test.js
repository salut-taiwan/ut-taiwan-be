'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentPayment } = require('../../presenters/paymentPresenter');

const NBSP = ' ';

describe('presentPayment', () => {
  test('decorates a pending payment with display + label fields', () => {
    const out = presentPayment({
      id: 'p1',
      status: 'pending',
      amount: 425000,
      unique_code: 425,
      expires_at: '2026-05-25T17:00:00Z',
      paid_at: null,
      proof_uploaded_at: null,
    });
    assert.equal(out.payment_status_label, 'Menunggu Pembayaran');
    assert.equal(out.amount_display, `Rp${NBSP}425.000`);
    assert.equal(out.unique_code_display, `Rp${NBSP}425`);
    assert.ok(out.expires_at_display);
    assert.equal(out.paid_at_display, null);
    assert.equal(out.proof_uploaded_at_display, null);
  });

  test('paid payment includes paid_at_display, payment_status_label=Lunas', () => {
    const out = presentPayment({
      id: 'p2',
      status: 'paid',
      amount: 100000,
      unique_code: 0,
      expires_at: null,
      paid_at: '2026-05-22T08:00:00Z',
      proof_uploaded_at: '2026-05-22T07:50:00Z',
    });
    assert.equal(out.payment_status_label, 'Lunas');
    assert.ok(out.paid_at_display);
    assert.ok(out.proof_uploaded_at_display);
  });

  test('null amount/unique_code → null displays', () => {
    const out = presentPayment({
      id: 'p3',
      status: 'pending',
      amount: null,
      unique_code: null,
      expires_at: null,
      paid_at: null,
      proof_uploaded_at: null,
    });
    assert.equal(out.amount_display, null);
    assert.equal(out.unique_code_display, null);
  });

  test('preserves raw fields', () => {
    const raw = { id: 'p4', status: 'pending', amount: 100, unique_code: 50, gateway: 'manual', method: 'bank_transfer' };
    const out = presentPayment(raw);
    assert.equal(out.id, 'p4');
    assert.equal(out.gateway, 'manual');
    assert.equal(out.method, 'bank_transfer');
    assert.equal(out.amount, 100);
  });

  test('passes through null payment', () => {
    assert.equal(presentPayment(null), null);
  });
});
