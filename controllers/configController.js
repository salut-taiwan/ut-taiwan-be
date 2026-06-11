const { SALUT_FEES, SALUT_MEMBERSHIP, PAYMENT_BANK, SKS_PAYMENT, SKS_PAYMENT_BANK, CHAT_WIDGET } = require('../config/constants');
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
        resetDates: SALUT_MEMBERSHIP.EXPIRY_DATES,
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
    paymentBank: {
      bank: PAYMENT_BANK.bank,
      account: PAYMENT_BANK.account,
      holder: PAYMENT_BANK.holder,
    },
    sksPayment: {
      rate_idr_per_ntd: SKS_PAYMENT.RATE_IDR_PER_NTD,
      payment_bank: {
        bank: SKS_PAYMENT_BANK.bank,
        account: SKS_PAYMENT_BANK.account,
        bank_code: SKS_PAYMENT_BANK.bank_code,
        swift_code: SKS_PAYMENT_BANK.swift_code,
        holder: SKS_PAYMENT_BANK.holder,
        currency: SKS_PAYMENT_BANK.currency,
      },
    },
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

function getChatWidget(req, res) {
  res.json({
    greeting: {
      enabled: CHAT_WIDGET.GREETING_ENABLED,
      text: CHAT_WIDGET.GREETING_TEXT,
      showDelayMs: CHAT_WIDGET.GREETING_SHOW_DELAY_MS,
      autoHideMs: CHAT_WIDGET.GREETING_AUTO_HIDE_MS,
    },
  });
}

module.exports = { getFees, getBanks, getChatWidget };
