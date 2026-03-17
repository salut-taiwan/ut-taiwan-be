/**
 * Email service — placeholder for order confirmation emails.
 * Wire up to a real provider (Resend, SendGrid, Nodemailer) when ready.
 */

async function sendOrderConfirmation({ email, name, orderNumber, totalAmount, items }) {
  // TODO: Implement with email provider
  console.log(`[Email] Order confirmation for ${email} — ${orderNumber} — IDR ${totalAmount}`);
}

async function sendPaymentReceipt({ email, name, orderNumber, paidAt }) {
  console.log(`[Email] Payment receipt for ${email} — ${orderNumber} — paid at ${paidAt}`);
}

module.exports = { sendOrderConfirmation, sendPaymentReceipt };
