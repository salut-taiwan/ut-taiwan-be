'use strict';

const { formatNTD, formatIDR, formatDate } = require('../format');
const { getSalutMembershipFee } = require('../config/constants');

function feeAmountDisplay(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? formatNTD(n) : null;
}

function buildApplicableFee(currentSemester) {
  if (!Number.isInteger(currentSemester) || currentSemester < 1 || currentSemester > 9) {
    return null;
  }
  const fee = getSalutMembershipFee(currentSemester);
  const amountDisplay = formatNTD(fee.amount);
  return {
    ...fee,
    amount_display: amountDisplay,
    // What the student actually transfers over QRIS.
    amount_idr_display: formatIDR(fee.amount_idr),
    tier_label: fee.tier === 'new'
      ? 'Mahasiswa baru (Semester 1)'
      : 'Mahasiswa lama (Semester 2+)',
  };
}

function deriveEffectiveStatus(rawStatus, isActive) {
  if (!rawStatus) return 'none';
  if (rawStatus === 'approved' && !isActive) return 'expired';
  return rawStatus;
}

function presentSalutStatus(row) {
  const isActive = Boolean(row.is_salut_active);
  const rawStatus = row.salut_status;
  const effective = deriveEffectiveStatus(rawStatus, isActive);

  return {
    ...row,
    effective_status: effective,
    is_member: effective === 'approved',
    is_pending: rawStatus === 'pending',
    applicable_fee: buildApplicableFee(row.current_semester),
    salut_applied_at_display: formatDate(row.salut_applied_at),
    salut_approved_at_display: formatDate(row.salut_approved_at),
    salut_applied_fee_amount_display: feeAmountDisplay(row.salut_applied_fee_amount),
  };
}

module.exports = { presentSalutStatus, buildApplicableFee };
