const SALUT_MEMBERSHIP = {
  CURRENCY: 'NTD',
  PRICE_NEW: 1700,
  PRICE_RETURNING: 1200,
  EXPIRY_MONTH: 5, // May
  EXPIRY_DAY: 1,   // 1st
  EXPIRY_TIMEZONE: 'Asia/Taipei',
  RENEWAL_NOTICE: 'Keanggotaan SALUT berakhir setiap 1 Mei pukul 00:00 (Asia/Taipei). Perpanjangan wajib dilakukan setiap tahun.',
};

// May 1 boundary in Asia/Taipei. Taipei is UTC+8 with no DST, so May 1 00:00 Taipei = April 30 16:00 UTC of the same year.
function may1UTC(year) {
  return new Date(Date.UTC(year, SALUT_MEMBERSHIP.EXPIRY_MONTH - 1, SALUT_MEMBERSHIP.EXPIRY_DAY, 0, 0, 0) - 8 * 60 * 60 * 1000);
}

function getSalutMembershipFee(currentSemester) {
  return currentSemester === 1
    ? { amount: SALUT_MEMBERSHIP.PRICE_NEW, currency: SALUT_MEMBERSHIP.CURRENCY, tier: 'new' }
    : { amount: SALUT_MEMBERSHIP.PRICE_RETURNING, currency: SALUT_MEMBERSHIP.CURRENCY, tier: 'returning' };
}

function nextSalutExpiry(fromDate = new Date()) {
  const year = fromDate.getUTCFullYear();
  const thisYearMay1 = may1UTC(year);
  return fromDate < thisYearMay1 ? thisYearMay1 : may1UTC(year + 1);
}

function mostRecentMay1Before(now = new Date()) {
  const year = now.getUTCFullYear();
  const thisYearMay1 = may1UTC(year);
  return now < thisYearMay1 ? may1UTC(year - 1) : thisYearMay1;
}

function isSalutActive(approvedAt, now = new Date()) {
  if (!approvedAt) return false;
  return new Date(approvedAt) >= mostRecentMay1Before(now);
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
  SALUT_FEES: { ONGKIR: 300000, BOX: 100000, ADMIN: 25000 },
  SALUT_MEMBERSHIP,
  getSalutMembershipFee,
  nextSalutExpiry,
  mostRecentMay1Before,
  isSalutActive,
};
