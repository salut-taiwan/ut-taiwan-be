'use strict';

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ntdNumberFormatter = new Intl.NumberFormat('zh-TW');

function formatIDR(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return idrFormatter.format(n);
}

function formatNTD(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `NT$ ${ntdNumberFormatter.format(n)}`;
}

function formatPriceOrFree(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'Gratis';
  return idrFormatter.format(n);
}

module.exports = { formatIDR, formatNTD, formatPriceOrFree };
