/**
 * Email service — powered by Resend.
 *
 * Templates are pure functions: each `templates.X(params)` returns `{ subject, html }`.
 * The `sendX` wrappers add I/O (Resend dispatch). This split lets tests assert template
 * output without mocking the Resend SDK.
 *
 * Never throws: errors are logged and swallowed so email failures never break order flow.
 */

const { Resend } = require('resend');
const env = require('../config/env');
const { formatIDR, formatPriceOrFree, formatDate, formatExpiryDate } = require('../format');

const resend = new Resend(env.RESEND_API_KEY);

// Emails are read in Indonesia → use Jakarta timezone for date stamps.
function emailDate(iso) {
  return formatDate(iso, { timeZone: 'Asia/Jakarta' });
}

function itemRows(items = []) {
  return items.map(i => {
    const label = i.module_code ? `${i.module_code} ${i.module_name}` : i.module_name;
    return `<tr>
      <td style="padding:6px 0;color:#374151;font-size:13px;">${label}</td>
      <td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;">${formatPriceOrFree(i.subtotal)}</td>
    </tr>`;
  }).join('');
}

const templates = {
  paymentRequest({ name, orderNumber, totalAmount, items, bank, account, expiresAt }) {
    return {
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
    ${expiresAt ? `<p style="margin:8px 0 0 0;font-size:12px;color:#dc2626;">Batas pembayaran: ${emailDate(expiresAt)}</p>` : ''}
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
    };
  },

  paymentConfirmed({ name, orderNumber, totalAmount, items }) {
    return {
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
    };
  },

  orderProcessing({ name, orderNumber, items }) {
    return {
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
    };
  },

  orderShipped({ name, orderNumber, items }) {
    return {
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
    };
  },

  orderConfirmation({ name, orderNumber, totalAmount, items }) {
    return {
      subject: `Pesanan diterima — ${orderNumber}`,
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <p style="color:#6b7280;font-size:13px;margin-top:0;">Konfirmasi Pesanan</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Pesanan Anda telah kami terima dan sedang diverifikasi stok oleh admin. Instruksi pembayaran akan dikirimkan melalui email setelah stok dikonfirmasi — Anda tidak perlu melakukan transfer sekarang.</p>
  <div style="background:#eef2ff;border:1px solid #a5b4fc;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#3730a3;font-weight:600;">Nomor Pesanan: ${orderNumber}</p>
  </div>
  <h3 style="font-size:14px;color:#374151;margin-bottom:8px;">Rincian Pesanan</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemRows(items)}
    <tr style="border-top:1px solid #e5e7eb;">
      <td style="padding:8px 0;font-weight:700;">Total</td>
      <td style="padding:8px 0;text-align:right;font-weight:700;color:#4f46e5;">${formatIDR(totalAmount)}</td>
    </tr>
  </table>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Anda dapat memantau status pesanan di halaman Pesanan.</p>
</div>`,
    };
  },

  orderCancelled({ name, orderNumber }) {
    return {
      subject: `Pesanan dibatalkan — ${orderNumber}`,
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Pesanan <strong>${orderNumber}</strong> telah dibatalkan sesuai permintaan Anda.</p>
  <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#991b1b;font-weight:600;">✕ Pesanan Dibatalkan</p>
  </div>
  <p style="font-size:13px;color:#374151;">Jika ada pertanyaan, hubungi kami di <a href="mailto:pengurus.uttaiwan@gmail.com" style="color:#4f46e5;">pengurus.uttaiwan@gmail.com</a>.</p>
</div>`,
    };
  },

  salutApproved({ name, expiresAt }) {
    const expiryLine = expiresAt
      ? `<p style="margin:8px 0 0 0;color:#047857;font-size:13px;">Keanggotaan berlaku hingga <strong>${formatExpiryDate(expiresAt)}</strong> (Asia/Taipei). Perpanjangan wajib dilakukan setiap semester (1 Mei dan 1 November).</p>`
      : '';
    return {
      subject: 'Keanggotaan SALUT Anda telah disetujui',
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Selamat! Permohonan keanggotaan SALUT Anda telah <strong>disetujui</strong>.</p>
  <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0 0 6px 0;color:#065f46;font-weight:600;">✓ Anggota SALUT Aktif</p>
    <p style="margin:0;color:#047857;font-size:13px;">Biaya ongkir, box, dan administrasi Anda akan dibebaskan untuk seluruh pesanan berikutnya.</p>
    ${expiryLine}
  </div>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Manfaat ini berlaku otomatis saat Anda melakukan checkout berikutnya.</p>
</div>`,
    };
  },

  salutRejected({ name, reason }) {
    return {
      subject: 'Permohonan SALUT Anda tidak dapat disetujui',
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Mohon maaf, permohonan keanggotaan SALUT Anda tidak dapat kami setujui saat ini.</p>
  <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0 0 6px 0;color:#991b1b;font-weight:600;">Alasan penolakan:</p>
    <p style="margin:0;color:#b91c1c;font-size:13px;">${reason}</p>
  </div>
  <p style="font-size:13px;color:#374151;">Anda dapat mengajukan kembali melalui halaman <strong>Profil</strong> setelah memenuhi persyaratan. Jika ada pertanyaan, hubungi kami di <a href="mailto:pengurus.uttaiwan@gmail.com" style="color:#4f46e5;">pengurus.uttaiwan@gmail.com</a>.</p>
</div>`,
    };
  },

  requestItemsResolved({ name, orderNumber, approved, rejected }) {
    const approvedRows = approved.map(n =>
      `<tr><td style="padding:5px 0;color:#065f46;font-size:13px;">✓ ${n}</td></tr>`
    ).join('');
    const rejectedRows = rejected.map(n =>
      `<tr><td style="padding:5px 0;color:#991b1b;font-size:13px;">✕ ${n}</td></tr>`
    ).join('');
    return {
      subject: `Permintaan barang diproses — ${orderNumber}`,
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">
  <h2 style="color:#4f46e5;margin-bottom:4px;">UT Taiwan</h2>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
  <p>Halo <strong>${name}</strong>,</p>
  <p>Admin telah selesai meninjau semua permintaan barang untuk pesanan <strong>${orderNumber}</strong>.</p>
  ${approved.length > 0 ? `
  <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:16px;margin:16px 0 8px 0;">
    <p style="margin:0 0 8px 0;color:#065f46;font-weight:600;">Disetujui</p>
    <table style="width:100%;border-collapse:collapse;">${approvedRows}</table>
  </div>` : ''}
  ${rejected.length > 0 ? `
  <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:8px 0 16px 0;">
    <p style="margin:0 0 8px 0;color:#991b1b;font-weight:600;">Tidak dapat dipenuhi</p>
    <table style="width:100%;border-collapse:collapse;">${rejectedRows}</table>
  </div>` : ''}
  ${approved.length > 0 ? `<p style="font-size:13px;color:#374151;">Instruksi pembayaran untuk item yang disetujui akan segera dikirimkan melalui email terpisah.</p>` : ''}
  <p style="font-size:12px;color:#9ca3af;margin-top:16px;">Pantau status pesanan Anda di halaman Pesanan.</p>
</div>`,
    };
  },
};

async function _send(payload) {
  if (!env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY not set — skipping send:', payload.subject);
    return;
  }
  const { data, error } = await resend.emails.send({ from: env.EMAIL_FROM, ...payload });
  if (error) console.error('[Email] send failed:', error);
  else console.log('[Email] sent id:', data.id);
}

async function sendPaymentRequest({ email, ...params }) {
  await _send({ to: email, ...templates.paymentRequest(params) });
}

async function sendPaymentConfirmed({ email, ...params }) {
  await _send({ to: email, ...templates.paymentConfirmed(params) });
}

async function sendOrderProcessing({ email, ...params }) {
  await _send({ to: email, ...templates.orderProcessing(params) });
}

async function sendOrderShipped({ email, ...params }) {
  await _send({ to: email, ...templates.orderShipped(params) });
}

async function sendOrderConfirmation({ email, ...params }) {
  await _send({ to: email, ...templates.orderConfirmation(params) });
}

async function sendOrderCancelled({ email, ...params }) {
  await _send({ to: email, ...templates.orderCancelled(params) });
}

async function sendSalutApproved({ email, ...params }) {
  await _send({ to: email, ...templates.salutApproved(params) });
}

async function sendSalutRejected({ email, ...params }) {
  await _send({ to: email, ...templates.salutRejected(params) });
}

async function sendRequestItemsResolved({ email, ...params }) {
  await _send({ to: email, ...templates.requestItemsResolved(params) });
}

async function sendPaymentReceipt({ email, name, orderNumber, paidAt }) {
  console.log(`[Email] Payment receipt for ${email} — ${orderNumber} — paid at ${paidAt}`);
}

module.exports = {
  sendPaymentRequest,
  sendPaymentConfirmed,
  sendOrderProcessing,
  sendOrderShipped,
  sendOrderConfirmation,
  sendOrderCancelled,
  sendSalutApproved,
  sendSalutRejected,
  sendRequestItemsResolved,
  sendPaymentReceipt,
  templates,
};
