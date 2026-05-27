'use strict';

const { formatIDR, formatNTD, formatDate } = require('../format');

const STATUS_LABEL = {
  pending:   'Menunggu Verifikasi',
  completed: 'Selesai',
  rejected:  'Ditolak',
};

const STATUS_TONE = {
  pending:   'warning',
  completed: 'success',
  rejected:  'danger',
};

function presentSksPayment(row) {
  return {
    id: row.id,
    nim: row.nim,
    name: row.name,
    semester_period: row.semester_period,
    idr_amount: Number(row.idr_amount),
    ntd_amount: Number(row.ntd_amount),
    rate_idr_per_ntd: Number(row.rate_idr_per_ntd),
    ut_slip_url: row.ut_slip_url,
    transfer_proof_url: row.transfer_proof_url,
    status: row.status,
    rejection_reason: row.rejection_reason ?? null,
    completed_at: row.completed_at,
    created_at: row.created_at,
    idr_amount_display: formatIDR(Number(row.idr_amount)),
    ntd_amount_display: formatNTD(Number(row.ntd_amount)),
    created_at_display: formatDate(row.created_at),
    completed_at_display: row.completed_at ? formatDate(row.completed_at) : null,
    status_label: STATUS_LABEL[row.status] || row.status,
    status_tone: STATUS_TONE[row.status] || 'neutral',
  };
}

function presentAdminSksPayment(row) {
  // row is expected to include email from a join.
  return {
    ...presentSksPayment(row),
    email: row.email,
  };
}

module.exports = { presentSksPayment, presentAdminSksPayment };
