/**
 * Email service — powered by Resend.
 * Never throws: errors are logged and swallowed so email failures never break order flow.
 */

const { Resend } = require('resend');
const env = require('../config/env');

const resend = new Resend(env.RESEND_API_KEY);

function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

function itemRows(items = []) {
  return items.map(i =>
    `<tr>
      <td style="padding:6px 0;color:#374151;font-size:13px;">${i.module_code} — ${i.module_name}</td>
      <td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;">${formatIDR(i.subtotal)}</td>
    </tr>`
  ).join('');
}

async function _send(payload) {
  if (!env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY not set — skipping send:', payload.subject);
    return;
  }
  const { data, error } = await resend.emails.send({ from: env.EMAIL_FROM, ...payload });
  if (error) console.error('[Email] send failed:', error);
  else console.log('[Email] sent id:', data.id);
}

/** sendPaymentRequest — triggered when admin confirms Karunika stock (→ awaiting_payment) */
async function sendPaymentRequest({ email, name, orderNumber, totalAmount, items, bank, account, expiresAt }) {
  await _send({
    to: email,
    subject: `Stok tersedia — silakan bayar ${orderNumber}`,
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <p style="color:#6b7280;font-size:13px;margin-top:0;">Konfirmasi Stok &amp; Instruksi Pembayaran</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Stok modul untuk pesanan Anda telah dikonfirmasi oleh admin. Silakan lakukan pembayaran sebelum batas waktu berikut:</p>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0 0 8px 0;font-weight:600;color:#92400e;">Instruksi Transfer Bank</p>
    <table style="width:100%;font-size:13px;">
      <tr><td style="color:#78350f;padding:4px 0;">Nomor Pesanan</td><td style="text-align:right;font-weight:600;">${orderNumber}</td></tr>
      <tr><td style="color:#78350f;padding:4px 0;">Bank</td><td style="text-align:right;font-weight:600;">${bank || 'BCA'}</td></tr>
      <tr><td style="color:#78350f;padding:4px 0;">No. Rekening</td><td style="text-align:right;font-family:monospace;font-weight:700;font-size:15px;">${account || '2950211345'}</td></tr>
      <tr><td style="color:#78350f;padding:4px 0;">Atas Nama</td><td style="text-align:right;font-weight:600;">Nathasya Vira Nerisa</td></tr>
      <tr style="border-top:1px solid #fcd34d;">
        <td style="color:#78350f;padding:8px 0 4px 0;font-weight:700;">Jumlah Tepat</td>
        <td style="text-align:right;font-weight:700;font-size:16px;color:#92400e;">${formatIDR(totalAmount)}</td>
      </tr>
    </table>
    ${expiresAt ? `<p style="margin:8px 0 0 0;font-size:12px;color:#dc2626;">Batas pembayaran: ${formatDate(expiresAt)}</p>` : ''}
  </div>
  <h3 style="font-size:14px;color:#374151;margin-bottom:8px;">Rincian Pesanan</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemRows(items)}
    <tr style="border-top:1px solid #e5e7eb;">
      <td style="padding:8px 0;font-weight:700;">Total</td>
      <td style="padding:8px 0;text-align:right;font-weight:700;color:#4f46e5;">${formatIDR(totalAmount)}</td>
    </tr>
  </table>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Harap transfer jumlah yang tepat dan simpan bukti transfer. Admin akan mengkonfirmasi pembayaran Anda.</p>
</div>`,
  });
}

/** sendPaymentConfirmed — triggered when admin confirms payment received (→ paid) */
async function sendPaymentConfirmed({ email, name, orderNumber, totalAmount, items }) {
  await _send({
    to: email,
    subject: `Pembayaran dikonfirmasi — ${orderNumber}`,
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Pembayaran untuk pesanan <strong>${orderNumber}</strong> telah kami konfirmasi. Pesanan Anda akan segera diproses.</p>
  <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#065f46;font-weight:600;">✓ Pembayaran Diterima — ${formatIDR(totalAmount)}</p>
  </div>
  <h3 style="font-size:14px;color:#374151;margin-bottom:8px;">Rincian Pesanan</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemRows(items)}
    <tr style="border-top:1px solid #e5e7eb;">
      <td style="padding:8px 0;font-weight:700;">Total</td>
      <td style="padding:8px 0;text-align:right;font-weight:700;color:#4f46e5;">${formatIDR(totalAmount)}</td>
    </tr>
  </table>
</div>`,
  });
}

/** sendOrderProcessing — triggered when admin moves order to processing */
async function sendOrderProcessing({ email, name, orderNumber, items }) {
  await _send({
    to: email,
    subject: `Pesanan sedang diproses — ${orderNumber}`,
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Pesanan <strong>${orderNumber}</strong> Anda sedang diproses dan disiapkan untuk pengiriman.</p>
  <div style="background:#eef2ff;border:1px solid #a5b4fc;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#3730a3;font-weight:600;">⚙ Sedang Diproses</p>
    <p style="margin:8px 0 0 0;color:#4338ca;font-size:13px;">Kami sedang menyiapkan modul-modul Anda. Kami akan memberitahu Anda ketika pesanan dikirim.</p>
  </div>
  <h3 style="font-size:14px;color:#374151;margin-bottom:8px;">Modul yang Dipesan</h3>
  <table style="width:100%;border-collapse:collapse;">${itemRows(items)}</table>
</div>`,
  });
}

/** sendOrderShipped — triggered when admin marks order as shipped */
async function sendOrderShipped({ email, name, orderNumber, items }) {
  await _send({
    to: email,
    subject: `Pesanan telah dikirim — ${orderNumber}`,
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Kabar gembira! Pesanan <strong>${orderNumber}</strong> telah dikirim ke alamat Anda.</p>
  <div style="background:#faf5ff;border:1px solid #c4b5fd;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#5b21b6;font-weight:600;">🚚 Pesanan Dikirim</p>
    <p style="margin:8px 0 0 0;color:#6d28d9;font-size:13px;">Setelah menerima paket, harap konfirmasi penerimaan melalui halaman pesanan Anda dalam 10 hari.</p>
  </div>
  <h3 style="font-size:14px;color:#374151;margin-bottom:8px;">Modul yang Dikirim</h3>
  <table style="width:100%;border-collapse:collapse;">${itemRows(items)}</table>
</div>`,
  });
}

/** sendOrderConfirmation — stub (called after checkout) */
async function sendOrderConfirmation({ email, name, orderNumber, totalAmount, items }) {
  console.log(`[Email] Order confirmation for ${email} — ${orderNumber} — IDR ${totalAmount}`);
}

/** sendPaymentReceipt — stub */
async function sendPaymentReceipt({ email, name, orderNumber, paidAt }) {
  console.log(`[Email] Payment receipt for ${email} — ${orderNumber} — paid at ${paidAt}`);
}

module.exports = {
  sendPaymentRequest,
  sendPaymentConfirmed,
  sendOrderProcessing,
  sendOrderShipped,
  sendOrderConfirmation,
  sendPaymentReceipt,
};
