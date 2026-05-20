const { SALUT_FEES, SALUT_MEMBERSHIP } = require('../config/constants');

function getFees(req, res) {
  res.json({
    salutMembership: {
      currency: SALUT_MEMBERSHIP.CURRENCY,
      new: SALUT_MEMBERSHIP.PRICE_NEW,
      returning: SALUT_MEMBERSHIP.PRICE_RETURNING,
      rule: 'new = current_semester === 1',
      renewalPolicy: {
        resetMonth: SALUT_MEMBERSHIP.EXPIRY_MONTH,
        resetDay: SALUT_MEMBERSHIP.EXPIRY_DAY,
        timezone: SALUT_MEMBERSHIP.EXPIRY_TIMEZONE,
        notice: SALUT_MEMBERSHIP.RENEWAL_NOTICE,
      },
    },
    serviceFees: [
      { label: 'Ongkir',      key: 'shipping', amount: SALUT_FEES.ONGKIR },
      { label: 'Biaya Box',   key: 'box',      amount: SALUT_FEES.BOX    },
      { label: 'Biaya Admin', key: 'admin',    amount: SALUT_FEES.ADMIN  },
    ],
    totalServiceFees: SALUT_FEES.ONGKIR + SALUT_FEES.BOX + SALUT_FEES.ADMIN,
    serviceFeesCurrency: 'IDR',
  });
}

module.exports = { getFees };
