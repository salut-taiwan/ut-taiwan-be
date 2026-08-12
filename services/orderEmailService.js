const { db } = require('../db');
const { orders, users } = require('../db/schema');
const { eq } = require('drizzle-orm');
const emailService = require('./emailService');

/**
 * Fetches the full order + user payload needed to send order-related emails.
 * Returns null if the order or user is not found.
 */
async function fetchOrderEmailPayload(orderId) {
  const order = await db.query.orders.findFirst({
    columns: { order_number: true, total_amount: true, user_id: true },
    where: eq(orders.id, orderId),
    with: {
      order_items: { columns: { module_code: true, module_name: true, quantity: true, unit_price: true, subtotal: true, is_request: true, request_status: true } },
    },
  });

  if (!order) return null;

  const userRow = await db.query.users.findFirst({
    columns: { email: true, name: true },
    where: eq(users.id, order.user_id),
  });

  if (!userRow) return null;

  return {
    email: userRow.email,
    name: userRow.name,
    orderNumber: order.order_number,
    totalAmount: order.total_amount,
    items: order.order_items,
  };
}

/**
 * Sends the appropriate status email for a given order status.
 * Silently logs and swallows errors so callers never throw due to email failure.
 */
async function sendStatusEmail(orderId, status) {
  try {
    const payload = await fetchOrderEmailPayload(orderId);
    if (!payload) return;

    if (status === 'paid')       await emailService.sendPaymentConfirmed(payload);
    else if (status === 'processing') await emailService.sendOrderProcessing(payload);
    else if (status === 'shipped')    await emailService.sendOrderShipped(payload);
  } catch (err) {
    console.error('[Email] Failed to send status email:', err.message);
  }
}

module.exports = { fetchOrderEmailPayload, sendStatusEmail };