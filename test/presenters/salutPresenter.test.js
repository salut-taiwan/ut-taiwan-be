'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { presentSalutStatus, buildApplicableFee } = require('../../presenters/salutPresenter');

const NBSP = '\u00a0';

// effectiveStatus is computed from raw status + is_salut_active.
// - active + approved => 'approved'
// - !active + approved => 'expired'  (lazy expiry)
// - otherwise => raw (or 'none' if null)
describe('presentSalutStatus — effective_status derivation (10 combinations)', () => {
  const cases = [
    // [raw_status, is_active, expected_effective, expected_is_member, expected_is_pending]
    ['none',      false, 'none',      false, false],
    ['none',      true,  'none',      false, false], // shouldn't happen but defensive
    ['pending',   false, 'pending',   false, true],
    ['pending',   true,  'pending',   false, true],  // shouldn't happen but defensive
    ['approved',  true,  'approved',  true,  false],
    ['approved',  false, 'expired',   false, false],
    ['rejected',  false, 'rejected',  false, false],
    ['rejected',  true,  'rejected',  false, false],
    ['expired',   false, 'expired',   false, false],
    [null,        false, 'none',      false, false],
  ];

  for (const [raw, active, expEff, expMember, expPending] of cases) {
    test(`raw=${raw} active=${active} -> effective=${expEff}, is_member=${expMember}, is_pending=${expPending}`, () => {
      const out = presentSalutStatus({
        is_salut: false,
        salut_status: raw,
        salut_applied_at: null,
        salut_rejection_reason: null,
        salut_approved_at: null,
        salut_applied_fee_amount: null,
        salut_applied_semester: null,
        current_semester: null,
        is_salut_active: active,
      });
      assert.equal(out.effective_status, expEff);
      assert.equal(out.is_member, expMember);
      assert.equal(out.is_pending, expPending);
    });
  }
});

describe('presentSalutStatus — applicable_fee', () => {
  test('semester=1 -> PRICE_NEW (1700 NTD), tier=new', () => {
    const out = presentSalutStatus({
      salut_status: 'none',
      is_salut_active: false,
      current_semester: 1,
    });
    assert.equal(out.applicable_fee.amount, 1700);
    assert.equal(out.applicable_fee.currency, 'NTD');
    assert.equal(out.applicable_fee.tier, 'new');
    assert.equal(out.applicable_fee.amount_display, 'NT$ 1,700');
    assert.equal(out.applicable_fee.amount_idr, null);
    assert.equal(out.applicable_fee.amount_idr_display, null);
    assert.equal(out.applicable_fee.tier_label, 'Mahasiswa UT Taiwan — sekali selama masa perkuliahan');
  });

  test('semester=2 -> same contribution (1700 NTD), tier=returning', () => {
    const out = presentSalutStatus({
      salut_status: 'none',
      is_salut_active: false,
      current_semester: 2,
    });
    assert.equal(out.applicable_fee.amount, 1700);
    assert.equal(out.applicable_fee.tier, 'returning');
    assert.equal(out.applicable_fee.amount_display, 'NT$ 1,700');
    assert.equal(out.applicable_fee.amount_idr, null);
    assert.equal(out.applicable_fee.amount_idr_display, null);
    assert.equal(out.applicable_fee.tier_label, 'Mahasiswa UT Taiwan — sekali selama masa perkuliahan');
  });

  test('missing semester still quotes the one-time contribution', () => {
    const out = presentSalutStatus({
      salut_status: 'none',
      is_salut_active: false,
      current_semester: null,
    });
    assert.equal(out.applicable_fee.amount, 1700);
  });
});

describe('presentSalutStatus — display dates', () => {
  test('salut_applied_at_display formats with id-ID Taipei timezone', () => {
    const out = presentSalutStatus({
      salut_status: 'pending',
      is_salut_active: false,
      salut_applied_at: '2026-05-20T06:30:00Z',
      current_semester: 1,
    });
    assert.equal(out.salut_applied_at_display, '20 Mei 2026 pukul 14.30');
  });

  test('salut_approved_at_display when null returns null', () => {
    const out = presentSalutStatus({
      salut_status: 'rejected',
      is_salut_active: false,
      salut_approved_at: null,
      current_semester: null,
    });
    assert.equal(out.salut_approved_at_display, null);
  });
});

describe('presentSalutStatus — applied fee display', () => {
  test('numeric salut_applied_fee_amount → NTD display', () => {
    const out = presentSalutStatus({
      salut_status: 'pending',
      is_salut_active: false,
      salut_applied_fee_amount: 1700,
      current_semester: 1,
    });
    assert.equal(out.salut_applied_fee_amount_display, 'NT$ 1,700');
  });

  test('string-typed numeric (Drizzle numeric col) also formats', () => {
    const out = presentSalutStatus({
      salut_status: 'approved',
      is_salut_active: true,
      salut_applied_fee_amount: '1200',
      current_semester: 3,
    });
    assert.equal(out.salut_applied_fee_amount_display, 'NT$ 1,200');
  });

  test('null fee → null display', () => {
    const out = presentSalutStatus({
      salut_status: 'none',
      is_salut_active: false,
      salut_applied_fee_amount: null,
      current_semester: null,
    });
    assert.equal(out.salut_applied_fee_amount_display, null);
  });
});

describe('buildApplicableFee', () => {
  test('one-time contribution does not depend on semester metadata', () => {
    assert.equal(buildApplicableFee(null).amount, 1700);
    assert.equal(buildApplicableFee(undefined).amount, 1700);
    assert.equal(buildApplicableFee(0).amount, 1700);
    assert.equal(buildApplicableFee('abc').amount, 1700);
  });

  test('returns fee object for semester 1', () => {
    const out = buildApplicableFee(1);
    assert.equal(out.tier, 'new');
    assert.equal(out.amount, 1700);
  });

  test('returns fee object for semester 3', () => {
    const out = buildApplicableFee(3);
    assert.equal(out.tier, 'returning');
    assert.equal(out.amount, 1700);
  });
});
