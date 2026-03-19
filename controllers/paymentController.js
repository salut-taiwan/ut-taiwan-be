const { supabaseAdmin } = require('../config/supabase');
const emailService = require('../services/emailService');

async function confirmPayment(req, res) {
  const { orderId } = req.params;
  const { error } = await supabaseAdmin.rpc('confirm_payment', { p_order_id: orderId });
  if (error) return res.status(400).json({ error: error.message });

  // Send payment confirmed email
  try {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('order_number, total_amount, user_id, order_items(module_code, module_name, quantity, unit_price, subtotal)')
      .eq('id', orderId)
      .single();

    if (order) {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('email, name')
        .eq('id', order.user_id)
        .single();

      if (userRow) {
        await emailService.sendPaymentConfirmed({
          email: userRow.email,
          name: userRow.name,
          orderNumber: order.order_number,
          totalAmount: order.total_amount,
          items: order.order_items,
        });
      }
    }
  } catch (emailErr) {
    console.error('[Email] Failed to send payment confirmed email:', emailErr.message);
  }

  res.json({ message: 'Pembayaran dikonfirmasi' });
}

async function getPaymentStatus(req, res) {
  const { orderId } = req.params;

  // Ownership check: verify this order belongs to the requesting user
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('user_id', req.user.id)
    .single();

  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Data pembayaran tidak ditemukan' });
  res.json(data);
}

module.exports = { confirmPayment, getPaymentStatus };