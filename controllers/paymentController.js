const { supabaseAdmin } = require('../config/supabase');
const orderEmailService = require('../services/orderEmailService');

async function confirmPayment(req, res) {
  const { orderId } = req.params;
  const { error } = await supabaseAdmin.rpc('confirm_payment', { p_order_id: orderId });
  if (error) return res.status(400).json({ error: error.message });

  await orderEmailService.sendStatusEmail(orderId, 'paid');

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
