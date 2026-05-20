const { SALUT_FEES, SALUT_MEMBERSHIP } = require('../config/constants');
const { presentFees } = require('../presenters/feesPresenter');
const { listBanks } = require('../config/banks');

function getFees(req, res) {
  const raw = {
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
  };
  res.json(presentFees(raw));
}

function getBanks(req, res) {
  const currency = String(req.query.currency || '').toUpperCase();
  if (currency !== 'NTD' && currency !== 'IDR') {
    return res.status(400).json({ error: "Query 'currency' wajib diisi: NTD atau IDR" });
  }
  const banks = listBanks(currency);
  res.json({ currency, banks });
}

module.exports = { getFees, getBanks };
