const SALUT_MEMBERSHIP = {
  CURRENCY: 'NTD',
  PRICE_NEW: 1700,
  PRICE_RETURNING: 1200,
  EXPIRY_MONTH: 5, // May (primary reset, kept for back-compat in payloads)
  EXPIRY_DAY: 1,   // 1st
  EXPIRY_DATES: [
    { month: 5, day: 1 },  // May 1
    { month: 11, day: 1 }, // November 1
  ],
  EXPIRY_TIMEZONE: 'Asia/Taipei',
  RENEWAL_NOTICE: 'Keanggotaan SALUT berakhir setiap 1 Mei dan 1 November pukul 00:00 (Asia/Taipei). Perpanjangan wajib dilakukan setiap semester.',
};

// Convert a boundary date (year/month/day, 00:00 Asia/Taipei) to UTC.
// Taipei is UTC+8 with no DST, so 00:00 Taipei = (previous day) 16:00 UTC.
function boundaryUTC(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 8 * 60 * 60 * 1000);
}

function getSalutMembershipFee(currentSemester) {
  const isNew = currentSemester === 1;
  const amount = isNew ? SALUT_MEMBERSHIP.PRICE_NEW : SALUT_MEMBERSHIP.PRICE_RETURNING;
  return {
    amount,
    currency: SALUT_MEMBERSHIP.CURRENCY,
    tier: isNew ? 'new' : 'returning',
    amount_idr: amount * RATE_IDR_PER_NTD,
  };
}

function allBoundariesAround(year) {
  const years = [year - 1, year, year + 1];
  const boundaries = [];
  for (const y of years) {
    for (const { month, day } of SALUT_MEMBERSHIP.EXPIRY_DATES) {
      boundaries.push(boundaryUTC(y, month, day));
    }
  }
  return boundaries.sort((a, b) => a - b);
}

function nextSalutExpiry(fromDate = new Date()) {
  const boundaries = allBoundariesAround(fromDate.getUTCFullYear());
  return boundaries.find((b) => b > fromDate);
}

function mostRecentExpiryBefore(now = new Date()) {
  const boundaries = allBoundariesAround(now.getUTCFullYear());
  let latest = null;
  for (const b of boundaries) {
    if (b <= now) latest = b;
  }
  return latest;
}

function isSalutActive(approvedAt, now = new Date()) {
  if (!approvedAt) return false;
  return new Date(approvedAt) >= mostRecentExpiryBefore(now);
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
