// SALUT contribution: one verified payment during the student's period of study.
// Existing admin revocation remains the way to end eligibility; no date-based reset.
const SALUT_MEMBERSHIP = {
  CURRENCY: 'NTD',
  PRICE_NEW: 1700,
  PRICE_RETURNING: 1700,
  BILLING: 'once_per_study',
  EXPIRY_MONTH: null,
  EXPIRY_DAY: null,
  EXPIRY_DATES: [],
  EXPIRY_TIMEZONE: 'Asia/Taipei',
  RENEWAL_NOTICE: 'Kontribusi NTD 1.700 dibayarkan satu kali selama masa perkuliahan, tanpa pembayaran ulang setiap semester.',
};

function getSalutMembershipFee(currentSemester) {
  return {
    amount: SALUT_MEMBERSHIP.PRICE_NEW,
    currency: SALUT_MEMBERSHIP.CURRENCY,
    // Retain the legacy enum for older API consumers; both tiers have the same fee.
    tier: currentSemester === 1 ? 'new' : 'returning',
    billing: SALUT_MEMBERSHIP.BILLING,
    amount_idr: null,
  };
}

// Compatibility functions: no periodic expiry exists under once-per-study billing.
function nextSalutExpiry() { return null; }
function mostRecentExpiryBefore() { return null; }
function isSalutActive(approvedAt, now = new Date()) {
  if (!approvedAt) return false;
  const approved = new Date(approvedAt).getTime();
  const current = new Date(now).getTime();
  return Number.isFinite(approved) && Number.isFinite(current) && approved <= current;
}

// One published NTD→IDR rate for the whole site: SKS payment quotes, and the
// SALUT membership fee, which is quoted in NTD but transferred in IDR via QRIS.
const RATE_IDR_PER_NTD = 560;

const SKS_PAYMENT = {
  RATE_IDR_PER_NTD,
};

const SKS_PAYMENT_BANK = {
  bank: 'Huanan',
  account: '154-20-045849-2',
  bank_code: '008',
  swift_code: 'HNBKTWTP',
  holder: 'Fadila Arum Rhamadani',
  currency: 'NTD',
};

function quoteNtdFromIdr(idr) {
  const rate = SKS_PAYMENT.RATE_IDR_PER_NTD;
  const idrNum = Number(idr);
  if (!Number.isFinite(idrNum) || idrNum <= 0) {
    return null;
  }
  return {
    idr_amount: idrNum,
    ntd_amount: Math.ceil(idrNum / rate),
    rate_idr_per_ntd: rate,
  };
}

module.exports = {
  PAYMENT_EXPIRY_MS: 5 * 24 * 60 * 60 * 1000,
  CONFIRM_DEADLINE_MS: 10.5 * 24 * 60 * 60 * 1000,
  SCRAPER_PAGE_SIZE: 1000,
  SCRAPER_UPLOAD_CONCURRENCY: 3,
  SCRAPER_UPLOAD_BATCH_DELAY_MS: 500,
  ORDER_STATUS_TRANSITIONS: {
    pending:          ['awaiting_payment'],
    awaiting_payment: ['paid'],
    paid:             ['processing', 'shipped'],
    processing:       ['shipped'],
    shipped:          ['delivered'],
  },
  ORDER_STEPS: ['pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'],
  PAYMENT_BANK: { bank: 'BCA', account: '2950211345', holder: 'Nathasya Vira Nerisa' },
  CHAT_WIDGET: {
    GREETING_ENABLED: true,
    GREETING_TEXT: 'Aku bisa jawab semua pertanyaan kamu sini, serius deh. 👋',
    GREETING_SHOW_DELAY_MS: 1500,
    GREETING_AUTO_HIDE_MS: 8000,
  },
  SALUT_FEES: { ONGKIR: 300000, BOX: 100000, ADMIN: 25000 },
  SALUT_MEMBERSHIP,
  getSalutMembershipFee,
  nextSalutExpiry,
  mostRecentExpiryBefore,
  isSalutActive,
  SKS_PAYMENT,
  SKS_PAYMENT_BANK,
  RATE_IDR_PER_NTD,
  quoteNtdFromIdr,
};
