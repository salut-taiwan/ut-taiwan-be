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
};
