'use strict';

const ORDER_STATUS_LABELS = Object.freeze({
  pending: 'Menunggu Konfirmasi Karunika',
  awaiting_payment: 'Menunggu Pembayaran',
  paid: 'Dibayar',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Terkirim',
  cancelled: 'Dibatalkan',
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  pending: 'Menunggu Pembayaran',
  paid: 'Lunas',
  expired: 'Kadaluarsa',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
});

const STEP_LABELS = Object.freeze({
  pending: 'Konfirmasi Karunika',
  awaiting_payment: 'Pembayaran',
  paid: 'Dibayar',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Terkirim',
});

const REQUEST_STATUS_LABELS = Object.freeze({
  pending: 'Menunggu Persetujuan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
});

function lookup(map, key) {
  if (key === null || key === undefined) return null;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

module.exports = {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  STEP_LABELS,
  REQUEST_STATUS_LABELS,
  getOrderStatusLabel: (s) => lookup(ORDER_STATUS_LABELS, s),
  getPaymentStatusLabel: (s) => lookup(PAYMENT_STATUS_LABELS, s),
  getStepLabel: (s) => lookup(STEP_LABELS, s),
  getRequestStatusLabel: (s) => lookup(REQUEST_STATUS_LABELS, s),
};
