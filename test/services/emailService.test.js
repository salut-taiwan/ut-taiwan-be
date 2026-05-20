'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { templates } = require('../../services/emailService');

// Common fixture
const items = [
  { module_code: 'MKDU4109', module_name: 'Bahasa Inggris', subtotal: 50000 },
  { module_code: 'EKMA4111', module_name: 'Pengantar Bisnis', subtotal: 50000 },
];

describe('templates.paymentRequest', () => {
  test('includes IDR-formatted total with NBSP and Jakarta-zoned deadline', () => {
    const { subject, html } = templates.paymentRequest({
      name: 'Andi',
      orderNumber: 'UT-2026-0001',
      totalAmount: 525000,
      items,
      bank: 'BCA',
      account: '2950211345',
      expiresAt: '2026-05-25T17:00:00Z',
    });
    assert.equal(subject, 'Stok tersedia — silakan bayar UT-2026-0001');
    assert.ok(html.includes('Halo <strong>Andi</strong>'));
    assert.ok(html.includes('Rp 525.000'), 'amount must include NBSP-separated Rp');
    assert.ok(html.includes('Rp 50.000'), 'item subtotal must be IDR-formatted');
    assert.ok(html.includes('MKDU4109 Bahasa Inggris'));
    assert.ok(html.includes('Batas pembayaran: 26 Mei 2026 pukul 00.00'), 'deadline in Asia/Jakarta');
  });

  test('skips deadline line when expiresAt is null', () => {
    const { html } = templates.paymentRequest({
      name: 'Andi',
      orderNumber: 'UT-1',
      totalAmount: 100000,
      items: [],
      expiresAt: null,
    });
    assert.ok(!html.includes('Batas pembayaran'));
  });

  test('falls back to default bank when omitted', () => {
    const { html } = templates.paymentRequest({
      name: 'X',
      orderNumber: 'A',
      totalAmount: 1000,
      items: [],
    });
    assert.ok(html.includes('BCA'));
    assert.ok(html.includes('2950211345'));
  });
});

describe('templates.paymentConfirmed', () => {
  test('renders confirmation with amount + items', () => {
    const { subject, html } = templates.paymentConfirmed({
      name: 'Budi',
      orderNumber: 'UT-2026-0002',
      totalAmount: 100000,
      items,
    });
    assert.equal(subject, 'Pembayaran dikonfirmasi — UT-2026-0002');
    assert.ok(html.includes('Pembayaran Diterima — Rp 100.000'));
    assert.ok(html.includes('EKMA4111'));
  });
});

describe('templates.orderProcessing', () => {
  test('renders processing notice with items', () => {
    const { subject, html } = templates.orderProcessing({
      name: 'C',
      orderNumber: 'UT-3',
      items,
    });
    assert.equal(subject, 'Pesanan sedang diproses — UT-3');
    assert.ok(html.includes('Sedang Diproses'));
    assert.ok(html.includes('MKDU4109'));
  });
});

describe('templates.orderShipped', () => {
  test('renders shipped notice', () => {
    const { subject, html } = templates.orderShipped({
      name: 'D',
      orderNumber: 'UT-4',
      items,
    });
    assert.equal(subject, 'Pesanan telah dikirim — UT-4');
    assert.ok(html.includes('Pesanan Dikirim'));
  });
});

describe('templates.orderConfirmation', () => {
  test('renders order received notice', () => {
    const { subject, html } = templates.orderConfirmation({
      name: 'E',
      orderNumber: 'UT-5',
      totalAmount: 425000,
      items,
    });
    assert.equal(subject, 'Pesanan diterima — UT-5');
    assert.ok(html.includes('Rp 425.000'));
  });
});

describe('templates.orderCancelled', () => {
  test('renders cancellation notice', () => {
    const { subject, html } = templates.orderCancelled({
      name: 'F',
      orderNumber: 'UT-6',
    });
    assert.equal(subject, 'Pesanan dibatalkan — UT-6');
    assert.ok(html.includes('Pesanan Dibatalkan'));
  });
});

describe('templates.salutApproved', () => {
  test('with expiresAt renders Taipei-zoned date-only line', () => {
    const { subject, html } = templates.salutApproved({
      name: 'G',
      expiresAt: '2027-05-01T00:00:00+08:00',
    });
    assert.equal(subject, 'Keanggotaan SALUT Anda telah disetujui');
    assert.ok(html.includes('Keanggotaan berlaku hingga <strong>1 Mei 2027</strong>'));
  });

  test('without expiresAt omits the expiry line', () => {
    const { html } = templates.salutApproved({ name: 'H' });
    assert.ok(!html.includes('Keanggotaan berlaku hingga'));
  });
});

describe('templates.salutRejected', () => {
  test('renders rejection with reason', () => {
    const { html } = templates.salutRejected({
      name: 'I',
      reason: 'Bukti pembayaran tidak terbaca',
    });
    assert.ok(html.includes('Bukti pembayaran tidak terbaca'));
  });
});

describe('templates.requestItemsResolved', () => {
  test('with both approved and rejected lists', () => {
    const { html } = templates.requestItemsResolved({
      name: 'J',
      orderNumber: 'UT-7',
      approved: ['Module A', 'Module B'],
      rejected: ['Module C'],
    });
    assert.ok(html.includes('Disetujui'));
    assert.ok(html.includes('✓ Module A'));
    assert.ok(html.includes('Tidak dapat dipenuhi'));
    assert.ok(html.includes('✕ Module C'));
    assert.ok(html.includes('Instruksi pembayaran untuk item yang disetujui'));
  });

  test('with only rejected (no approved) — omits approved block and payment instruction', () => {
    const { html } = templates.requestItemsResolved({
      name: 'K',
      orderNumber: 'UT-8',
      approved: [],
      rejected: ['Module X'],
    });
    assert.ok(!html.includes('Disetujui'));
    assert.ok(html.includes('Tidak dapat dipenuhi'));
    assert.ok(!html.includes('Instruksi pembayaran untuk item yang disetujui'));
  });
});
