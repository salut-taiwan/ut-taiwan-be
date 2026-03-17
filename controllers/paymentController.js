const { supabaseAdmin } = require('../config/supabase');

async function confirmPayment(req, res) {
  const { orderId } = req.params;
  const { error } = await supabaseAdmin.rpc('confirm_payment', { p_order_id: orderId });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Pembayaran dikonfirmasi' });
}

async function getPaymentStatus(req, res) {
  const { orderId } = req.params;

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