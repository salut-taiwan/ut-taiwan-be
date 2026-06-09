'use strict';

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ntdNumberFormatter = new Intl.NumberFormat('zh-TW');

/**
 * Format a number as Indonesian Rupiah, e.g. "Rp 150.000". Returns null for
 * null/undefined/non-finite inputs.
 * @param {number|string|null|undefined} amount
 * @returns {string|null}
 */
function formatIDR(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return idrFormatter.format(n);
}

/**
 * Format a number as New Taiwan Dollar, e.g. "NT$ 5,000". Returns null for
 * null/undefined/non-finite inputs.
 * @param {number|string|null|undefined} amount
 * @returns {string|null}
 */
function formatNTD(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `NT$ ${ntdNumberFormatter.format(n)}`;
}

/**
 * Format a number as IDR, or "Gratis" when amount is 0. Returns null for
 * null/undefined/non-finite inputs.
 * @param {number|string|null|undefined} amount
 * @returns {string|null}
 */
function formatPriceOrFree(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'Gratis';
  return idrFormatter.format(n);
}

module.exports = { formatIDR, formatNTD, formatPriceOrFree };
