'use strict';

const { formatIDR, formatNTD } = require('../format');
const { formatExpiryDate } = require('../format/datetime');
const { nextSalutExpiry } = require('../config/constants');

function formatIdrPlain(n) {
  return new Intl.NumberFormat('id-ID').format(Number(n));
}

function presentFees(dto) {
  const newDisplay = formatNTD(dto.salutMembership.new);
  const returningDisplay = formatNTD(dto.salutMembership.returning);
  const nextRenewal = nextSalutExpiry();
  const presented = {
    ...dto,
    salutMembership: {
      ...dto.salutMembership,
      new_display: newDisplay,
      returning_display: returningDisplay,
      new_label: `${newDisplay} (semester 1)`,
      returning_label: `${returningDisplay} (semester 2+)`,
      tier_combined_display: `${newDisplay} (semester 1) atau ${returningDisplay} (semester 2+)`,
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
  // goes through /sks-payment/quote.
  if (dto.sksPayment) {
    presented.sksPayment = {
      rate_label: `Rp ${formatIdrPlain(dto.sksPayment.rate_idr_per_ntd)} / NT$ 1`,
    };
  }

  return presented;
}

module.exports = { presentFees };
