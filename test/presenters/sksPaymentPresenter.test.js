'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  presentSksPayment,
  presentAdminSksPayment,
} = require('../../presenters/sksPaymentPresenter');

const NBSP = '\u00a0';

const row = (over = {}) => ({
  id: 'sks-1',
  nim: '041234567',
  name: 'Budi Santoso',
  semester_period: '2026.1',
  // numeric columns arrive as strings on any path that bypasses drizzle's mapping
  idr_amount: '5600000.00',
  ntd_amount: '10000.00',
  rate_idr_per_ntd: '560.00',
  ut_slip_url: 'u-1/slip_1.pdf',
  transfer_proof_url: 'u-1/proof_1.png',
  status: 'pending',
  rejection_reason: null,
  completed_at: null,
  created_at: '2026-05-20T06:30:00Z',
  ...over,
});

describe('presentSksPayment — amounts', () => {
  test('numeric-string columns are coerced to numbers', () => {
    const out = presentSksPayment(row());
    assert.equal(out.idr_amount, 5600000);
    assert.equal(out.ntd_amount, 10000);
    assert.equal(out.rate_idr_per_ntd, 560);
    assert.equal(typeof out.idr_amount, 'number');
  });

  test('already-numeric columns pass through unchanged', () => {
    const out = presentSksPayment(row({ idr_amount: 5600000, ntd_amount: 10000 }));
    assert.equal(out.idr_amount, 5600000);
    assert.equal(out.ntd_amount, 10000);
  });

  test('the IDR amount renders as rupiah and the NTD amount as NT$', () => {
    const out = presentSksPayment(row());
    assert.equal(out.idr_amount_display, `Rp${NBSP}5.600.000`);
    assert.equal(out.ntd_amount_display, 'NT$ 10,000');
  });
});

describe('presentSksPayment — status', () => {
  test('pending reads as awaiting verification, toned as a warning', () => {
    const out = presentSksPayment(row({ status: 'pending' }));
    assert.equal(out.status_label, 'Menunggu Verifikasi');
    assert.equal(out.status_tone, 'warning');
  });

  test('completed reads as done, toned as success', () => {
    const out = presentSksPayment(row({ status: 'completed' }));
    assert.equal(out.status_label, 'Selesai');
    assert.equal(out.status_tone, 'success');
  });

  test('rejected reads as refused, toned as danger', () => {
    const out = presentSksPayment(row({ status: 'rejected' }));
    assert.equal(out.status_label, 'Ditolak');
    assert.equal(out.status_tone, 'danger');
  });

  test('an unrecognised status degrades to the raw value with a neutral tone', () => {
    const out = presentSksPayment(row({ status: 'archived' }));
    assert.equal(out.status_label, 'archived');
    assert.equal(out.status_tone, 'neutral');
  });
});

describe('presentSksPayment — nullable fields', () => {
  test('a missing rejection reason is null, never undefined — JSON would drop it', () => {
    const out = presentSksPayment(row({ rejection_reason: undefined }));
    assert.equal(out.rejection_reason, null);
    assert.ok('rejection_reason' in out);
  });

  test('a present rejection reason is carried through', () => {
    const out = presentSksPayment(row({ status: 'rejected', rejection_reason: 'Bukti tidak terbaca' }));
    assert.equal(out.rejection_reason, 'Bukti tidak terbaca');
  });

  test('an unfinished payment has no completion date rather than an invalid one', () => {
    assert.equal(presentSksPayment(row()).completed_at_display, null);
  });

  test('a completed payment renders its completion date', () => {
    const out = presentSksPayment(row({ status: 'completed', completed_at: '2026-05-22T08:00:00Z' }));
    assert.ok(out.completed_at_display);
    assert.notEqual(out.completed_at_display, 'Invalid Date');
  });

  test('the submission date is always rendered', () => {
    assert.ok(presentSksPayment(row()).created_at_display);
  });
});

describe('presentSksPayment — passthrough', () => {
  test('identity and file fields survive untouched', () => {
    const out = presentSksPayment(row());
    assert.equal(out.id, 'sks-1');
    assert.equal(out.nim, '041234567');
    assert.equal(out.name, 'Budi Santoso');
    assert.equal(out.semester_period, '2026.1');
    assert.equal(out.ut_slip_url, 'u-1/slip_1.pdf');
    assert.equal(out.transfer_proof_url, 'u-1/proof_1.png');
  });
});

describe('presentAdminSksPayment', () => {
  test('adds the joined email and changes nothing else', () => {
    const source = row({ email: 'budi@example.com' });
    const student = presentSksPayment(source);
    const admin = presentAdminSksPayment(source);
    assert.equal(admin.email, 'budi@example.com');
    assert.deepEqual({ ...admin, email: undefined }, { ...student, email: undefined });
  });

  test('a missing email is undefined rather than throwing', () => {
    assert.equal(presentAdminSksPayment(row()).email, undefined);
  });
});
