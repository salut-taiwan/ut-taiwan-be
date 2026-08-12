'use strict';

const { formatIDR, formatNTD } = require('../format');
const { formatExpiryDate } = require('../format/datetime');
const { nextSalutExpiry, RATE_IDR_PER_NTD } = require('../config/constants');

function formatIdrPlain(n) {
  return new Intl.NumberFormat('id-ID').format(Number(n));
}

function presentFees(dto) {
  const newDisplay = formatNTD(dto.salutMembership.new);
  const returningDisplay = formatNTD(dto.salutMembership.returning);
  // The fee is quoted in NTD but paid in IDR over QRIS, so the IDR figure is the
  // one students actually transfer. Converted here, not on the FE, which never
  // receives the rate.
  const newIdrDisplay = formatIDR(Number(dto.salutMembership.new) * RATE_IDR_PER_NTD);
  const returningIdrDisplay = formatIDR(Number(dto.salutMembership.returning) * RATE_IDR_PER_NTD);
  const nextRenewal = nextSalutExpiry();
  const presented = {
    ...dto,
    salutMembership: {
      ...dto.salutMembership,
      new_display: newDisplay,
      returning_display: returningDisplay,
      new_display_idr: newIdrDisplay,
      returning_display_idr: returningIdrDisplay,
      new_label: `${newDisplay} (semester 1)`,
      returning_label: `${returningDisplay} (semester 2+)`,
      tier_combined_display: `${newDisplay} (semester 1) atau ${returningDisplay} (semester 2+)`,
      tier_combined_display_idr: `${newIdrDisplay} (semester 1) atau ${returningIdrDisplay} (semester 2+)`,
      renewalPolicy: {
        ...dto.salutMembership.renewalPolicy,
        next_renewal_date_display: nextRenewal ? formatExpiryDate(nextRenewal.toISOString()) : null,
      },
    },
    serviceFees: dto.serviceFees.map((f) => ({
      ...f,
      amount_display: formatIDR(f.amount),
    })),
    totalServiceFees_display: formatIDR(dto.totalServiceFees),
  };

  // sksPayment: present only the display string. Deliberately drop the raw
  // rate_idr_per_ntd so the FE cannot do its own NTD math; all conversion
  // goes through /sks-payment/quote. payment_bank passes through verbatim.
  if (dto.sksPayment) {
    presented.sksPayment = {
      rate_label: `Rp ${formatIdrPlain(dto.sksPayment.rate_idr_per_ntd)} / NT$ 1`,
      payment_bank: dto.sksPayment.payment_bank,
    };
  }

  return presented;
}

module.exports = { presentFees };
