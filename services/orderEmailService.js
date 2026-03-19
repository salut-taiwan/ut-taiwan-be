const { supabaseAdmin } = require('../config/supabase');
const emailService = require('./emailService');

/**
 * Fetches the full order + user payload needed to send order-related emails.
 * Returns null if the order or user is not found.
 */
async function fetchOrderEmailPayload(orderId) {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('order_number, total_amount, user_id, order_items(module_code, module_name, quantity, unit_price, subtotal)')
    .eq('id', orderId)
    .single();

  if (!order) return null;

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('email, name')
    .eq('id', order.user_id)
    .single();

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
