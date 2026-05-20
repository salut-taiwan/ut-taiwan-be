'use strict';

const {
  formatIDR,
  formatDate,
  getPaymentStatusLabel,
} = require('../format');

function presentPayment(p) {
  if (!p) return p;
  return {
    ...p,
    payment_status_label: getPaymentStatusLabel(p.status),
    amount_display: p.amount != null ? formatIDR(Number(p.amount)) : null,
    unique_code_display: p.unique_code != null ? formatIDR(Number(p.unique_code)) : null,
    expires_at_display: formatDate(p.expires_at),
    paid_at_display: formatDate(p.paid_at),
    proof_uploaded_at_display: formatDate(p.proof_uploaded_at),
  };
}

module.exports = { presentPayment };
