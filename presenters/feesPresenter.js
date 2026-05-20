'use strict';

const { formatIDR, formatNTD } = require('../format');

function presentFees(dto) {
  const newDisplay = formatNTD(dto.salutMembership.new);
  const returningDisplay = formatNTD(dto.salutMembership.returning);
  return {
    ...dto,
    salutMembership: {
      ...dto.salutMembership,
      new_display: newDisplay,
      returning_display: returningDisplay,
      new_label: `${newDisplay} (semester 1)`,
      returning_label: `${returningDisplay} (semester 2+)`,
      tier_combined_display: `${newDisplay} (semester 1) atau ${returningDisplay} (semester 2+)`,
    },
    serviceFees: dto.serviceFees.map((f) => ({
      ...f,
      amount_display: formatIDR(f.amount),
    })),
    totalServiceFees_display: formatIDR(dto.totalServiceFees),
  };
}

module.exports = { presentFees };
